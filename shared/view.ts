import type { Ledger, Overrides, Transaction } from "./schema";

/**
 * Vue consolidée = ledger (pipeline) + overrides (corrections manuelles).
 * Une correction s'applique aussi si la transaction visée a été fusionnée
 * dans une autre lors d'un rapprochement (mergedFrom).
 */
export function consolidate(ledger: Ledger, overrides: Overrides): Transaction[] {
  const deleted = new Set(overrides.deleted);
  const out: Transaction[] = [];
  for (const tx of ledger.transactions) {
    const ids = [tx.id, ...tx.mergedFrom];
    if (ids.some((id) => deleted.has(id))) continue;
    let merged = tx;
    for (const id of ids) {
      const patch = overrides.edits[id];
      if (patch) merged = { ...merged, ...patch, id: tx.id, mergedFrom: tx.mergedFrom };
    }
    out.push(merged);
  }
  for (const tx of overrides.added) {
    if (deleted.has(tx.id)) continue;
    const patch = overrides.edits[tx.id];
    out.push(patch ? { ...tx, ...patch, id: tx.id } : tx);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.label.localeCompare(b.label));
}

export function normalizeLabel(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\b(CB|CARTE|PRLV|PRELEVEMENT|SEPA|VIR|VIREMENT|FACTURE|PAIEMENT)\b/g, " ")
    .replace(/\d{2}[/.]\d{2}([/.]\d{2,4})?/g, " ") // dates incrustées
    .replace(/X{2,}\d*/g, " ") // numéros de carte masqués
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
