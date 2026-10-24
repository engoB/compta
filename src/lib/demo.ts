import type { DocumentRecord, Ledger, Transaction } from "../../shared/schema";

/** Données fictives pour découvrir l'app avant de connecter le dépôt. */
export function demoLedger(): Ledger {
  const now = new Date();
  const txs: Transaction[] = [];
  const docs: DocumentRecord[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const recurring: [string, string, string, number, number][] = [
    ["VIR SALAIRE ACME SAS", "Acme", "Revenus", 2850, 28],
    ["PRLV LOYER SCI DES LILAS", "SCI des Lilas", "Logement", -920, 3],
    ["PRLV EDF CLIENTS", "EDF", "Énergie", -78.4, 8],
    ["PRLV FREE MOBILE", "Free", "Télécom & Internet", -19.99, 6],
    ["PRLV MAIF ASSURANCE", "MAIF", "Assurances", -42.1, 10],
    ["CB NETFLIX.COM", "Netflix", "Abonnements", -13.49, 14],
  ];
  const variable: [string, string, string, number][] = [
    ["CB CARREFOUR MARKET", "Carrefour", "Alimentation", 65],
    ["CB LIDL", "Lidl", "Alimentation", 38],
    ["CB TOTALENERGIES", "TotalEnergies", "Carburant", 58],
    ["CB SNCF CONNECT", "SNCF", "Transport", 42],
    ["CB LE BISTROT", "Le Bistrot", "Restaurants", 31],
    ["CB PHARMACIE CENTRALE", "Pharmacie", "Santé", 18],
    ["CB FNAC", "Fnac", "Shopping", 54],
    ["CB DECATHLON", "Decathlon", "Loisirs", 47],
  ];
  for (let k = 11; k >= 0; k--) {
    const y = now.getFullYear();
    const m = now.getMonth() - k;
    const last = new Date(y, m + 1, 0).getDate();
    const ym = new Date(y, m, 1);
    const prefix = `${ym.getFullYear()}-${String(ym.getMonth() + 1).padStart(2, "0")}`;
    const docId = `demo${prefix.replace("-", "")}`;
    const ids: string[] = [];
    const push = (day: number, label: string, merchant: string, category: string, amount: number) => {
      const date = `${prefix}-${String(Math.min(day, last)).padStart(2, "0")}`;
      if (new Date(date) > now) return;
      const id = `t_${docId}_${ids.length}`;
      ids.push(id);
      txs.push({
        id, date, label, merchant, category, amount: Math.round(amount * 100) / 100, currency: "EUR",
        account: "Compte courant ****4821", docId, receiptIds: [], mergedFrom: [],
        status: k === 0 && rnd() < 0.3 ? "to_review" : k > 1 ? "verified" : "auto", confidence: 0.95,
      });
    };
    for (const [l, mch, c, a, d] of recurring) push(d, l, mch, c, a);
    for (let i = 0; i < 14; i++) {
      const [l, mch, c, a] = variable[Math.floor(rnd() * variable.length)];
      push(1 + Math.floor(rnd() * 28), l, mch, c, -(a * (0.5 + rnd())));
    }
    docs.push({
      id: docId, filename: `releve-${prefix}.pdf`, path: `archive/${prefix.replace("-", "/")}/${docId}-releve.pdf`,
      kind: "bank_statement", status: k === 0 ? "to_review" : "processed", processedAt: now.toISOString(),
      model: "claude-opus-5-5", issuer: "Banque Démo", periodStart: `${prefix}-01`, periodEnd: `${prefix}-${last}`,
      checks: [
        { name: "Opérations trouvées", ok: true, detail: `${ids.length} opération(s)` },
        { name: "Rapprochement des soldes", ok: k !== 0, detail: k === 0 ? "Écart de 12,40 €" : "OK" },
      ],
      transactionIds: ids, costUsd: 0.03,
    });
  }
  return { version: 1, updatedAt: now.toISOString(), transactions: txs, documents: docs };
}
