import Papa from "papaparse";
import { parseAmount, parseDate } from "./util";

/** Ligne brute issue d'un export bancaire déterministe (CSV/OFX). */
export interface RawTx {
  date: string;
  label: string;
  amount: number;
  account?: string;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const COLS = {
  date: [/^date( (d.)?op(eration)?)?$/, /^date$/, /date comptable/, /^booking date$/, /^date valeur$/],
  label: [/^libelle/, /^description/, /^label/, /^detail/, /^intitule/, /^nature/, /^payee/, /^memo/],
  amount: [/^montant/, /^amount/, /^valeur$/],
  debit: [/^debit/],
  credit: [/^credit/],
};

function findCol(header: string[], patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = header.findIndex((h) => p.test(norm(h)));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Parse heuristique des exports CSV des banques françaises (BNP, SG, CA, Boursorama,
 * Qonto, Revolut…). Renvoie null si la structure n'est pas reconnue → le pipeline
 * bascule alors sur l'analyse IA du texte.
 */
export function parseBankCsv(text: string): RawTx[] | null {
  const { data } = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: true });
  for (let h = 0; h < Math.min(data.length, 30); h++) {
    const header = data[h];
    const iDate = findCol(header, COLS.date);
    const iLabel = findCol(header, COLS.label);
    const iAmount = findCol(header, COLS.amount);
    const iDebit = findCol(header, COLS.debit);
    const iCredit = findCol(header, COLS.credit);
    if (iDate < 0 || iLabel < 0 || (iAmount < 0 && iDebit < 0 && iCredit < 0)) continue;

    const out: RawTx[] = [];
    for (const row of data.slice(h + 1)) {
      const date = parseDate(row[iDate]);
      if (!date) continue;
      let amount: number | null;
      if (iAmount >= 0) amount = parseAmount(row[iAmount]);
      else {
        const d = parseAmount(row[iDebit]) ?? 0;
        const c = parseAmount(row[iCredit]) ?? 0;
        amount = c - Math.abs(d);
      }
      if (amount === null || amount === 0) continue;
      out.push({ date, label: (row[iLabel] ?? "").trim(), amount });
    }
    return out.length ? out : null;
  }
  return null;
}

/** Parse OFX/QFX (SGML ou XML) — export standard de quasiment toutes les banques. */
export function parseOfx(text: string): RawTx[] | null {
  const tag = (block: string, name: string) =>
    block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"))?.[1]?.trim() ?? "";
  const account = tag(text, "ACCTID") || undefined;
  const out: RawTx[] = [];
  for (const m of text.matchAll(/<STMTTRN>([\s\S]*?)(<\/STMTTRN>|(?=<STMTTRN>)|<\/BANKTRANLIST>)/gi)) {
    const b = m[1];
    const date = parseDate(tag(b, "DTPOSTED"));
    const amount = parseAmount(tag(b, "TRNAMT"));
    if (!date || amount === null) continue;
    const label = [tag(b, "NAME"), tag(b, "MEMO")].filter(Boolean).join(" — ");
    out.push({ date, label, amount, account });
  }
  return out.length ? out : null;
}
