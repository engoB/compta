import type { Ledger, Overrides, Rules, Transaction } from "../shared/schema";
import { normalizeLabel } from "../shared/view";

const merchantKey = (t: Pick<Transaction, "merchant" | "label">) =>
  normalizeLabel(t.merchant || t.label).split(" ").slice(0, 2).join(" ");

/**
 * Apprentissage à partir des corrections manuelles (à la manière des « payee rules »
 * d'Actual Budget) : si tu as recatégorisé « SNCF » en Transport, les prochaines
 * opérations SNCF le seront aussi.
 */
export function learnFromOverrides(ledger: Ledger, overrides: Overrides): Map<string, string> {
  const byId = new Map<string, Transaction>();
  for (const t of ledger.transactions) {
    byId.set(t.id, t);
    for (const m of t.mergedFrom) byId.set(m, t);
  }
  for (const t of overrides.added) byId.set(t.id, t);
  const learned = new Map<string, string>();
  for (const [id, patch] of Object.entries(overrides.edits)) {
    const base = byId.get(id);
    if (!base || !patch.category) continue;
    const key = merchantKey({ ...base, ...patch });
    if (key) learned.set(key, patch.category);
  }
  for (const t of overrides.added) {
    const key = merchantKey(t);
    if (key) learned.set(key, overrides.edits[t.id]?.category ?? t.category);
  }
  return learned;
}

export function compileRules(rules: Rules) {
  return rules.rules.flatMap((r) => {
    try {
      return [{ ...r, re: new RegExp(r.pattern, "i") }];
    } catch {
      console.warn(`Règle ignorée (regex invalide) : ${r.pattern}`);
      return [];
    }
  });
}

/** Règles explicites > apprentissage > proposition de l'IA. */
export function categorize(
  tx: Transaction,
  compiled: ReturnType<typeof compileRules>,
  learned: Map<string, string>,
): Transaction {
  const haystack = `${tx.label} ${tx.merchant ?? ""}`;
  const rule = compiled.find((r) => r.re.test(haystack));
  if (rule) return { ...tx, category: rule.category, merchant: rule.merchant ?? tx.merchant };
  const l = learned.get(merchantKey(tx));
  if (l) return { ...tx, category: l };
  return tx;
}
