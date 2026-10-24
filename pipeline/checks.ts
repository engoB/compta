import type { Check } from "../shared/schema";
import type { Extraction } from "./extract";
import { daysBetween, isIsoDate, round2 } from "./util";

/**
 * Contrôles de cohérence comptable. Un contrôle « bloquant » en échec déclenche
 * une seconde analyse plus approfondie, puis le statut « à vérifier ».
 */
export function runChecks(x: Extraction, today = new Date().toISOString().slice(0, 10)): { checks: Check[]; blocking: Check[] } {
  const checks: Check[] = [];
  const blocking: Check[] = [];
  const add = (c: Check, isBlocking = true) => {
    checks.push(c);
    if (!c.ok && isBlocking) blocking.push(c);
  };

  if (x.documentType !== "other") {
    add({ name: "Opérations trouvées", ok: x.transactions.length > 0, detail: `${x.transactions.length} opération(s)` });
  }

  const badDates = x.transactions.filter((t) => !isIsoDate(t.date) || t.date > today);
  add({
    name: "Dates valides",
    ok: badDates.length === 0,
    detail: badDates.length ? `Invalides/futures : ${badDates.map((t) => t.date).join(", ")}` : "OK",
  });

  const sum = round2(x.transactions.reduce((s, t) => s + t.amount, 0));

  if (x.documentType === "bank_statement" && x.openingBalance != null && x.closingBalance != null) {
    const expected = round2(x.closingBalance - x.openingBalance);
    add({
      name: "Rapprochement des soldes",
      ok: Math.abs(expected - sum) <= 0.02,
      detail: `Solde initial ${x.openingBalance} + opérations ${sum} = ${round2(x.openingBalance + sum)} (relevé : ${x.closingBalance})`,
    });
  }

  if ((x.documentType === "receipt" || x.documentType === "invoice") && x.total != null) {
    const abs = round2(Math.abs(sum));
    add({
      name: "Total du justificatif",
      ok: Math.abs(abs - Math.abs(x.total)) <= 0.02,
      detail: `Somme ${abs} / total imprimé ${x.total}`,
    });
  }

  if (x.documentType === "bank_statement" && isIsoDate(x.periodStart) && isIsoDate(x.periodEnd)) {
    const out = x.transactions.filter(
      (t) => isIsoDate(t.date) && (daysBetween(x.periodStart!, t.date) < -5 || daysBetween(t.date, x.periodEnd!) < -5),
    );
    add({
      name: "Dates dans la période",
      ok: out.length === 0,
      detail: out.length ? `${out.length} opération(s) hors période` : `${x.periodStart} → ${x.periodEnd}`,
    });
  }

  add({ name: "Confiance du modèle", ok: x.confidence >= 0.7, detail: `${Math.round(x.confidence * 100)} %` }, false);
  return { checks, blocking };
}
