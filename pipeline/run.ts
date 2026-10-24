/**
 * Passe d'automatisation (quotidienne + à chaque dépôt) :
 *   inbox/ (+ Google Drive) → analyse → contrôles → catégorisation → rapprochement
 *   → data/ledger.json, fichiers déplacés dans archive/AAAA/MM/.
 * Le commit/push est fait par le workflow GitHub Actions.
 */
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  defaultRules, DocumentRecord, emptyLedger, emptyOverrides, Ledger, Overrides, Rules,
  type DocumentKind, type Transaction,
} from "../shared/schema";
import { categorize, compileRules, learnFromOverrides } from "./categorize";
import { runChecks } from "./checks";
import { pullFromDrive } from "./drive";
import { classifyLabels, extract, MODEL, RETRY_EFFORT, type DocInput, type Extraction } from "./extract";
import { parseBankCsv, parseOfx, type RawTx } from "./parsers";
import { isDuplicate, reconcileReceipts, statementTxId } from "./reconcile";
import { round2, sha } from "./util";

const ROOT = process.env.COMPTA_ROOT || process.cwd();
const INBOX = path.join(ROOT, "inbox");
const ARCHIVE = path.join(ROOT, "archive");
const DATA = path.join(ROOT, "data");
const DRY_RUN = process.argv.includes("--dry-run");
const IGNORED = new Set([".gitkeep", "README.md", ".DS_Store"]);

async function readJson<T>(file: string, schema: { parse: (v: unknown) => T }, fallback: () => T): Promise<T> {
  if (!existsSync(file)) return fallback();
  return schema.parse(JSON.parse(await readFile(file, "utf8")));
}

const writeJson = (file: string, value: unknown) => writeFile(file, JSON.stringify(value, null, 2) + "\n");

async function listFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && !IGNORED.has(e.name) && !e.name.startsWith("."))
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
}

/** Les photos de smartphone sont réduites (≤ 2400 px) : meilleure lecture, moins de tokens. */
async function prepareImage(buf: Buffer): Promise<DocInput> {
  const img = sharp(buf, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  if (buf.length < 3_500_000 && Math.max(meta.width ?? 0, meta.height ?? 0) <= 2400 && meta.format === "jpeg") {
    return { type: "image", data: buf, mediaType: "image/jpeg" };
  }
  const out = await img.resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { type: "image", data: out, mediaType: "image/jpeg" };
}

function rawToTransactions(raw: RawTx[], docId: string): Transaction[] {
  const seen = new Map<string, number>();
  return raw.map((r) => {
    const k = `${r.date}|${r.amount}|${r.label}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return {
      id: statementTxId(r.date, r.amount, r.label, n),
      date: r.date,
      label: r.label,
      merchant: null,
      amount: round2(r.amount),
      currency: "EUR",
      category: "Autre",
      account: r.account ?? null,
      docId,
      receiptIds: [],
      mergedFrom: [],
      status: "auto",
      confidence: 1,
    } satisfies Transaction;
  });
}

function extractionToTransactions(x: Extraction, docId: string, status: Transaction["status"]): Transaction[] {
  const isStatement = x.documentType === "bank_statement";
  const seen = new Map<string, number>();
  return x.transactions.map((t, i) => {
    const k = `${t.date}|${t.amount}|${t.label}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return {
      id: isStatement ? statementTxId(t.date, t.amount, t.label, n) : `r_${docId}${i ? `_${i}` : ""}`,
      date: t.date,
      label: t.label,
      merchant: t.merchant,
      amount: round2(t.amount),
      currency: x.currency || "EUR",
      category: t.category,
      account: x.accountLabel,
      paymentMethod: t.paymentMethod,
      vatAmount: t.vatAmount,
      vatRate: t.vatRate,
      docId,
      receiptIds: isStatement ? [] : [docId],
      mergedFrom: [],
      status,
      confidence: x.confidence,
    } satisfies Transaction;
  });
}

interface Processed {
  record: DocumentRecord;
  transactions: Transaction[];
}

async function processFile(file: string, docId: string, categories: string[]): Promise<Processed> {
  const filename = path.basename(file);
  const ext = path.extname(filename).toLowerCase();
  const buf = await readFile(file);
  const now = new Date().toISOString();
  const base = { id: docId, filename, path: "", processedAt: now, checks: [], transactionIds: [] };

  // 1) Exports bancaires structurés : analyse déterministe, gratuite et exacte.
  if (ext === ".ofx" || ext === ".qfx" || ext === ".csv") {
    const text = buf.toString("utf8");
    const raw = ext === ".csv" ? parseBankCsv(text) : parseOfx(text);
    if (raw) {
      const kind = ext === ".csv" ? "csv" : "ofx";
      const txs = rawToTransactions(raw, docId);
      const dates = txs.map((t) => t.date).sort();
      return {
        record: {
          ...base, kind, status: "processed", model: null,
          periodStart: dates[0], periodEnd: dates.at(-1),
          checks: [{ name: "Lecture structurée", ok: true, detail: `${txs.length} opération(s) importée(s) sans IA` }],
        },
        transactions: txs,
      };
    }
    console.log(`  ${filename} : structure non reconnue → analyse IA du texte`);
  }

  // 2) PDF, photos, textes : extraction par Claude + contrôles comptables.
  let input: DocInput;
  if (ext === ".pdf") input = { type: "pdf", data: buf };
  else if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".tif", ".tiff"].includes(ext)) input = await prepareImage(buf);
  else if ([".csv", ".txt", ".ofx", ".qfx", ".md", ".json", ".eml"].includes(ext)) input = { type: "text", data: buf.toString("utf8") };
  else throw new Error(`Format non pris en charge : ${ext || "(aucune extension)"}`);

  let res = await extract(input, categories, { filename });
  let cost = res.costUsd;
  let { checks, blocking } = runChecks(res.extraction);
  if (blocking.length) {
    console.log(`  ${filename} : contrôles en échec → seconde analyse (effort ${RETRY_EFFORT})`);
    const feedback = blocking.map((c) => `- ${c.name} : ${c.detail}`).join("\n");
    const retry = await extract(input, categories, { filename, effort: RETRY_EFFORT, feedback });
    cost += retry.costUsd;
    const r2 = runChecks(retry.extraction);
    if (r2.blocking.length <= blocking.length) ({ checks, blocking } = r2), (res = retry);
  }

  const x = res.extraction;
  const lowConfidence = x.confidence < 0.7;
  const status = blocking.length || lowConfidence ? "to_review" : "processed";
  const kind: DocumentKind = x.documentType;
  return {
    record: {
      ...base, kind, status, model: res.model,
      issuer: x.issuer, documentDate: x.documentDate, periodStart: x.periodStart, periodEnd: x.periodEnd,
      total: x.total, openingBalance: x.openingBalance, closingBalance: x.closingBalance,
      checks, notes: x.notes, costUsd: round2(cost * 10000) / 10000,
    },
    transactions: extractionToTransactions(x, docId, status === "to_review" ? "to_review" : "auto"),
  };
}

async function aiCategorize(txs: Transaction[], categories: string[]): Promise<Transaction[]> {
  const todo = txs.filter((t) => t.category === "Autre");
  if (!todo.length || !process.env.ANTHROPIC_API_KEY) return txs;
  try {
    const res = await classifyLabels(todo, categories);
    if (!res) return txs;
    todo.forEach((t, i) => Object.assign(t, { category: res[i].category, merchant: t.merchant ?? res[i].merchant }));
  } catch (e) {
    console.error("  Catégorisation IA indisponible :", e instanceof Error ? e.message : e);
  }
  return txs;
}

async function archive(file: string, docId: string, dateHint: string | null | undefined): Promise<string> {
  const d = dateHint && /^\d{4}-\d{2}/.test(dateHint) ? dateHint : new Date().toISOString();
  const dir = path.join(ARCHIVE, d.slice(0, 4), d.slice(5, 7));
  await mkdir(dir, { recursive: true });
  const name = path.basename(file).replace(/[^\w.\-]+/g, "_");
  const dest = path.join(dir, name.startsWith(docId) ? name : `${docId}-${name}`);
  if (!DRY_RUN) await rename(file, dest);
  return path.relative(ROOT, dest).split(path.sep).join("/");
}

async function main() {
  await mkdir(INBOX, { recursive: true });
  await mkdir(DATA, { recursive: true });

  const drive = await pullFromDrive(INBOX).catch((e) => {
    console.error("Google Drive indisponible :", e.message);
    return 0;
  });
  if (drive) console.log(`${drive} fichier(s) récupéré(s) depuis Google Drive`);

  const ledger = await readJson(path.join(DATA, "ledger.json"), Ledger, emptyLedger);
  const overrides = await readJson(path.join(DATA, "overrides.json"), Overrides, emptyOverrides);
  const rules = await readJson(path.join(DATA, "rules.json"), Rules, defaultRules);
  const compiled = compileRules(rules);
  const learned = learnFromOverrides(ledger, overrides);
  const known = new Set(ledger.documents.map((d) => d.id));

  const files = await listFiles(INBOX);
  console.log(`${files.length} fichier(s) dans inbox/ — modèle ${MODEL}`);
  const report = { processed: 0, toReview: 0, errors: 0, duplicates: 0, newTx: 0, matched: 0, costUsd: 0 };

  for (const file of files) {
    const buf = await readFile(file);
    const docId = sha(buf);
    if (known.has(docId)) {
      console.log(`  ${path.basename(file)} : déjà traité (doublon)`);
      report.duplicates++;
      if (!DRY_RUN) await rm(file); // l'original est déjà archivé
      continue;
    }
    try {
      const { record, transactions } = await processFile(file, docId, rules.categories);
      let fresh = transactions
        .map((t) => categorize(t, compiled, learned))
        .filter((t) => !isDuplicate(t, ledger.transactions));
      if (record.kind === "csv" || record.kind === "ofx") fresh = await aiCategorize(fresh, rules.categories);
      record.transactionIds = fresh.map((t) => t.id);
      record.path = await archive(file, docId, record.periodEnd ?? record.documentDate);
      ledger.documents.push(DocumentRecord.parse(record));
      ledger.transactions.push(...fresh);
      known.add(docId);
      report.processed++;
      report.newTx += fresh.length;
      report.costUsd += record.costUsd ?? 0;
      if (record.status === "to_review") report.toReview++;
      console.log(`  ✓ ${record.filename} : ${record.kind}, ${fresh.length} opération(s), ${record.status}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`  ✗ ${path.basename(file)} : ${message}`);
      report.errors++;
      ledger.documents.push({
        id: docId, filename: path.basename(file), path: await archive(file, docId, null), kind: "other",
        status: "error", processedAt: new Date().toISOString(), checks: [], transactionIds: [], error: message,
      });
      known.add(docId);
    }
  }

  // Les règles s'appliquent rétroactivement (les corrections manuelles restent prioritaires à l'affichage).
  ledger.transactions = ledger.transactions.map((t) => categorize(t, compiled, learned));
  const rec = reconcileReceipts(ledger.transactions);
  ledger.transactions = rec.txs.sort((a, b) => b.date.localeCompare(a.date));
  report.matched = rec.matched;
  ledger.updatedAt = new Date().toISOString();

  if (!DRY_RUN) {
    await writeJson(path.join(DATA, "ledger.json"), ledger);
    await writeJson(path.join(DATA, "last-run.json"), { at: ledger.updatedAt, model: MODEL, ...report, costUsd: round2(report.costUsd * 10000) / 10000 });
    if (!existsSync(path.join(DATA, "rules.json"))) await writeJson(path.join(DATA, "rules.json"), rules);
  }

  const summary = [
    `## Passe comptable — ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`,
    "",
    `| Traités | À vérifier | Erreurs | Doublons | Nouvelles opérations | Tickets rapprochés | Coût IA |`,
    `|---|---|---|---|---|---|---|`,
    `| ${report.processed} | ${report.toReview} | ${report.errors} | ${report.duplicates} | ${report.newTx} | ${report.matched} | ${report.costUsd.toFixed(4)} $ |`,
  ].join("\n");
  console.log("\n" + summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
