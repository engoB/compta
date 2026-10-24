import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const MODEL = process.env.COMPTA_MODEL || "claude-opus-5-5";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORT = (process.env.COMPTA_EFFORT || "medium") as Effort;
export const RETRY_EFFORT = (process.env.COMPTA_RETRY_EFFORT || "high") as Effort;

/** $/million de tokens (entrée, sortie) — pour le suivi des coûts. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export function buildSchema(categories: string[]) {
  const ExtractedTx = z.object({
    date: z.string().describe("Date de l'opération, format YYYY-MM-DD"),
    label: z.string().describe("Libellé tel qu'imprimé (relevé) ou description courte (ticket)"),
    merchant: z.string().nullable().describe("Nom commercial normalisé, ex. 'Carrefour', 'SNCF'"),
    amount: z.number().describe("Montant signé : négatif = débit/dépense, positif = crédit/recette"),
    category: z.enum(categories as [string, ...string[]]),
    paymentMethod: z
      .enum(["carte", "virement", "prélèvement", "chèque", "espèces", "retrait", "autre"])
      .nullable(),
    vatRate: z.number().nullable().describe("Taux de TVA en % si indiqué (20, 10, 5.5…)"),
    vatAmount: z.number().nullable().describe("Montant de TVA si indiqué"),
  });
  return z.object({
    documentType: z.enum(["bank_statement", "receipt", "invoice", "other"]),
    issuer: z.string().nullable().describe("Banque, commerçant ou fournisseur"),
    accountLabel: z.string().nullable().describe("Compte concerné (ex. 'Compte courant ****1234')"),
    documentDate: z.string().nullable().describe("YYYY-MM-DD"),
    periodStart: z.string().nullable().describe("Relevé : début de période, YYYY-MM-DD"),
    periodEnd: z.string().nullable().describe("Relevé : fin de période, YYYY-MM-DD"),
    currency: z.string().describe("Code ISO, ex. EUR"),
    openingBalance: z.number().nullable().describe("Relevé : solde initial (signé)"),
    closingBalance: z.number().nullable().describe("Relevé : solde final (signé)"),
    total: z.number().nullable().describe("Ticket/facture : total TTC payé (positif)"),
    totalVat: z.number().nullable(),
    transactions: z.array(ExtractedTx),
    notes: z.string().nullable().describe("Anomalies, zones illisibles, doutes"),
    confidence: z.number().describe("Confiance globale entre 0 et 1"),
  });
}
export type Extraction = z.infer<ReturnType<typeof buildSchema>>;

const SYSTEM = `Tu es un expert-comptable français méticuleux. Tu extrais des données comptables
de documents (relevés bancaires, tickets de caisse, factures) avec une exactitude au centime.

Règles :
- Relevé bancaire : extrais CHAQUE ligne d'opération, sans en omettre ni en inventer. Ignore les
  lignes de report/total/solde. Montant négatif pour un débit, positif pour un crédit. Renseigne
  les soldes initial et final tels qu'imprimés : la somme des opérations doit les réconcilier.
- Ticket de caisse / facture payée : UNE seule transaction égale au total TTC payé, négative
  (dépense) ; positive seulement s'il s'agit d'un remboursement ou d'une facture émise (recette).
  Le libellé résume l'achat (ex. "Courses alimentaires", "Plein gazole 45 L").
- Dates au format YYYY-MM-DD. Si l'année manque sur une ligne de relevé, déduis-la de la période.
- Catégorise avec la liste fournie ; "Virements internes" pour les transferts entre comptes
  de la même personne ; "Autre" en dernier recours.
- N'invente rien : mets null quand une information est absente, et signale tout doute dans notes.
- confidence < 0.7 si le document est flou, tronqué ou ambigu.`;

export type DocInput =
  | { type: "pdf"; data: Buffer }
  | { type: "image"; data: Buffer; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }
  | { type: "text"; data: string };

export interface ExtractResult {
  extraction: Extraction;
  costUsd: number;
  model: string;
}

let client: Anthropic | null = null;

export async function extract(
  doc: DocInput,
  categories: string[],
  opts: { effort?: Effort; feedback?: string; filename: string },
): Promise<ExtractResult> {
  client ??= new Anthropic();
  const schema = buildSchema(categories);

  const block: Anthropic.Beta.BetaContentBlockParam =
    doc.type === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.data.toString("base64") } }
      : doc.type === "image"
        ? { type: "image", source: { type: "base64", media_type: doc.mediaType, data: doc.data.toString("base64") } }
        : { type: "document", source: { type: "text", media_type: "text/plain", data: doc.data } };

  let instruction = `Fichier : ${opts.filename}\nCatégories autorisées : ${categories.join(", ")}.\nExtrais les données comptables de ce document.`;
  if (opts.feedback) {
    instruction += `\n\nUne première extraction a échoué aux contrôles suivants :\n${opts.feedback}\nRelis le document ligne par ligne et corrige.`;
  }

  // Les replis côté serveur ne s'appliquent pas à Haiku.
  const fallback = MODEL.startsWith("claude-haiku")
    ? {}
    : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    ...fallback,
    output_config: { effort: opts.effort ?? EFFORT, format: betaZodOutputFormat(schema) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [block, { type: "text", text: instruction }] }],
  });
  const msg = await stream.finalMessage();

  if (msg.stop_reason === "refusal") throw new Error("Analyse refusée par le modèle");
  if (msg.stop_reason === "max_tokens") throw new Error("Réponse tronquée (document trop long)");
  const extraction = msg.parsed_output ?? null;
  if (!extraction) throw new Error("Sortie structurée invalide");

  const [pin, pout] = PRICES[msg.model] ?? PRICES[MODEL] ?? [0, 0];
  const u = msg.usage;
  const inputTokens =
    u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  const costUsd = (inputTokens * pin + u.output_tokens * pout) / 1e6;
  return { extraction, costUsd, model: msg.model };
}

/**
 * Catégorisation IA des lignes importées sans IA (CSV/OFX) : un seul appel
 * pour tout le lot, sur les seuls libellés — quelques centimes au plus.
 */
export async function classifyLabels(
  items: { label: string; amount: number }[],
  categories: string[],
): Promise<{ category: string; merchant: string | null }[] | null> {
  if (!items.length) return [];
  client ??= new Anthropic();
  const schema = z.object({
    results: z.array(
      z.object({
        index: z.number(),
        category: z.enum(categories as [string, ...string[]]),
        merchant: z.string().nullable(),
      }),
    ),
  });
  const lines = items.map((t, i) => `${i}\t${t.amount.toFixed(2)}\t${t.label}`).join("\n");
  const fallback = MODEL.startsWith("claude-haiku")
    ? {}
    : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
  const msg = await client.beta.messages
    .stream({
      model: MODEL,
      max_tokens: 64000,
      ...fallback,
      output_config: { effort: "low", format: betaZodOutputFormat(schema) },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Catégories autorisées : ${categories.join(", ")}.\nPour chaque ligne de relevé (index, montant, libellé), donne la catégorie et le marchand normalisé.\n\n${lines}`,
        },
      ],
    })
    .finalMessage();
  if (msg.stop_reason !== "end_turn" || !msg.parsed_output) return null;
  const out = items.map(() => ({ category: "Autre", merchant: null as string | null }));
  for (const r of msg.parsed_output.results) if (out[r.index]) out[r.index] = { category: r.category, merchant: r.merchant };
  return out;
}
