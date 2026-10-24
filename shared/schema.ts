import { z } from "zod";

/** Catégories par défaut — modifiables dans data/rules.json. */
export const DEFAULT_CATEGORIES = [
  "Revenus",
  "Alimentation",
  "Restaurants",
  "Transport",
  "Carburant",
  "Logement",
  "Énergie",
  "Télécom & Internet",
  "Santé",
  "Assurances",
  "Abonnements",
  "Shopping",
  "Loisirs",
  "Voyages",
  "Impôts & taxes",
  "Frais bancaires",
  "Épargne & placements",
  "Virements internes",
  "Professionnel",
  "Autre",
] as const;

export const DocumentKind = z.enum(["bank_statement", "receipt", "invoice", "csv", "ofx", "other"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const TxStatus = z.enum(["auto", "to_review", "verified"]);
export type TxStatus = z.infer<typeof TxStatus>;

export const Transaction = z.object({
  id: z.string(),
  date: z.string(), // YYYY-MM-DD
  label: z.string(),
  merchant: z.string().nullish(),
  amount: z.number(), // signé : négatif = dépense, positif = recette
  currency: z.string().default("EUR"),
  category: z.string(),
  account: z.string().nullish(),
  paymentMethod: z.string().nullish(),
  vatAmount: z.number().nullish(),
  vatRate: z.number().nullish(),
  notes: z.string().nullish(),
  docId: z.string().nullish(), // document source
  receiptIds: z.array(z.string()).default([]), // justificatifs rapprochés
  mergedFrom: z.array(z.string()).default([]), // ids absorbés lors d'un rapprochement
  status: TxStatus,
  confidence: z.number().nullish(),
  manual: z.boolean().optional(), // saisi à la main dans l'app
});
export type Transaction = z.infer<typeof Transaction>;

export const Check = z.object({ name: z.string(), ok: z.boolean(), detail: z.string() });
export type Check = z.infer<typeof Check>;

export const DocumentRecord = z.object({
  id: z.string(), // sha256 tronqué du contenu
  filename: z.string(),
  path: z.string(), // chemin dans le dépôt (archive/…)
  kind: DocumentKind,
  status: z.enum(["processed", "to_review", "error"]),
  processedAt: z.string(),
  model: z.string().nullish(),
  issuer: z.string().nullish(),
  documentDate: z.string().nullish(),
  periodStart: z.string().nullish(),
  periodEnd: z.string().nullish(),
  total: z.number().nullish(),
  openingBalance: z.number().nullish(),
  closingBalance: z.number().nullish(),
  checks: z.array(Check).default([]),
  notes: z.string().nullish(),
  transactionIds: z.array(z.string()).default([]),
  error: z.string().nullish(),
  costUsd: z.number().nullish(),
});
export type DocumentRecord = z.infer<typeof DocumentRecord>;

/** data/ledger.json — écrit UNIQUEMENT par le pipeline. */
export const Ledger = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  transactions: z.array(Transaction),
  documents: z.array(DocumentRecord),
});
export type Ledger = z.infer<typeof Ledger>;

/** data/overrides.json — écrit UNIQUEMENT par l'app (corrections manuelles). */
export const Overrides = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  edits: z.record(z.string(), Transaction.partial()),
  added: z.array(Transaction),
  deleted: z.array(z.string()),
});
export type Overrides = z.infer<typeof Overrides>;

export const Rule = z.object({
  pattern: z.string(), // regex insensible à la casse, testée sur libellé + marchand
  category: z.string(),
  merchant: z.string().optional(), // nom normalisé à appliquer
});
export type Rule = z.infer<typeof Rule>;

/** data/rules.json — écrit par l'app (réglages), lu par le pipeline. */
export const Rules = z.object({
  categories: z.array(z.string()),
  rules: z.array(Rule),
});
export type Rules = z.infer<typeof Rules>;

export const emptyLedger = (): Ledger => ({
  version: 1,
  updatedAt: new Date(0).toISOString(),
  transactions: [],
  documents: [],
});

export const emptyOverrides = (): Overrides => ({
  version: 1,
  updatedAt: new Date(0).toISOString(),
  edits: {},
  added: [],
  deleted: [],
});

export const defaultRules = (): Rules => ({ categories: [...DEFAULT_CATEGORIES], rules: [] });
