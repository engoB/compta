import type { Transaction } from "../shared/schema";
import { normalizeLabel } from "../shared/view";
import { daysBetween, sha, tokenSimilarity } from "./util";

/** Identifiant stable d'une ligne de relevé (permet le dédoublonnage entre relevés qui se chevauchent). */
export function statementTxId(date: string, amount: number, label: string, occurrence: number) {
  return "t_" + sha(`${date}|${amount.toFixed(2)}|${normalizeLabel(label)}|${occurrence}`, 12);
}

export const isStatementTx = (t: Transaction) => t.id.startsWith("t_");
export const isReceiptTx = (t: Transaction) => t.id.startsWith("r_");

/** Vrai si `t` est déjà présent dans `existing` (même date, même montant, libellé proche). */
export function isDuplicate(t: Transaction, existing: Transaction[]): boolean {
  const nl = normalizeLabel(t.label);
  return existing.some(
    (e) =>
      isStatementTx(e) &&
      (e.id === t.id ||
        (e.docId !== t.docId &&
          e.date === t.date &&
          Math.abs(e.amount - t.amount) < 0.005 &&
          tokenSimilarity(normalizeLabel(e.label), nl) >= 0.5)),
  );
}

/**
 * Rapprochement justificatif ↔ opération bancaire (comme le « matching » de Firefly III / Pennylane) :
 * même montant au centime, débit bancaire entre 2 jours avant et 10 jours après le ticket,
 * marchand ressemblant en bonus. Le ticket est fusionné dans la ligne bancaire.
 */
export function reconcileReceipts(txs: Transaction[]): { txs: Transaction[]; matched: number } {
  const bank = txs.filter(isStatementTx);
  const receipts = txs.filter((t) => isReceiptTx(t));
  const absorbed = new Set<string>();
  let matched = 0;

  for (const r of receipts) {
    const rKey = normalizeLabel(r.merchant || r.label);
    let best: { t: Transaction; score: number } | null = null;
    for (const b of bank) {
      if (b.receiptIds.length && b.receiptIds.some((id) => id !== r.docId)) continue;
      if (Math.abs(b.amount - r.amount) > 0.005) continue;
      const dd = daysBetween(r.date, b.date);
      if (dd < -2 || dd > 10) continue;
      const sim = tokenSimilarity(normalizeLabel(`${b.merchant ?? ""} ${b.label}`), rKey);
      const score = Math.abs(dd) - sim * 5;
      if (!best || score < best.score) best = { t: b, score };
    }
    if (!best) continue;
    const b = best.t;
    if (r.docId && !b.receiptIds.includes(r.docId)) b.receiptIds.push(r.docId);
    if (!b.mergedFrom.includes(r.id)) b.mergedFrom.push(r.id);
    b.merchant ??= r.merchant;
    b.vatAmount ??= r.vatAmount;
    b.vatRate ??= r.vatRate;
    if (b.category === "Autre") b.category = r.category;
    if (r.status === "to_review") b.status = "to_review";
    absorbed.add(r.id);
    matched++;
  }
  return { txs: txs.filter((t) => !absorbed.has(t.id)), matched };
}
