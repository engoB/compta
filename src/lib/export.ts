import Papa from "papaparse";
import type { Ledger, Overrides, Rules, Transaction } from "../../shared/schema";
import { byCategory, byMonth, totals } from "./stats";
import { monthLabel, money } from "./format";

export interface ExportInput {
  txs: Transaction[]; // déjà filtrées sur la période
  months: string[];
  periodLabel: string;
  includeInternal: boolean;
}

const STATUS: Record<Transaction["status"], string> = { auto: "Automatique", to_review: "À vérifier", verified: "Vérifiée" };

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

const COLUMNS = [
  "Date", "Libellé", "Marchand", "Catégorie", "Montant", "Devise", "Compte",
  "Moyen de paiement", "TVA", "Taux TVA", "Statut", "Justificatifs", "Notes",
] as const;

const rows = (txs: Transaction[]): Record<(typeof COLUMNS)[number], string | number>[] =>
  txs.map((t) => ({
    Date: t.date,
    Libellé: t.label,
    Marchand: t.merchant ?? "",
    Catégorie: t.category,
    Montant: t.amount,
    Devise: t.currency,
    Compte: t.account ?? "",
    "Moyen de paiement": t.paymentMethod ?? "",
    TVA: t.vatAmount ?? "",
    "Taux TVA": t.vatRate ?? "",
    Statut: STATUS[t.status],
    Justificatifs: t.receiptIds.length,
    Notes: t.notes ?? "",
  }));

/** CSV « à la française » : séparateur ;, virgule décimale, BOM UTF-8 → s'ouvre proprement dans Excel. */
export function exportCsv({ txs }: ExportInput) {
  const data = rows(txs).map((r) => ({ ...r, Montant: Number(r.Montant).toFixed(2).replace(".", ",") }));
  const csv = Papa.unparse(data, { delimiter: ";" });
  save(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `compta-${stamp()}.csv`);
}

export async function exportXlsx({ txs, months, includeInternal }: ExportInput) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const head = (labels: string[]) => labels.map((value) => ({ value, fontWeight: "bold" as const }));
  const ops = [
    head([...COLUMNS]),
    ...rows(txs).map((row) =>
      COLUMNS.map((k) => {
        const v = row[k];
        if (k === "Date") return { value: new Date(String(v) + "T00:00:00"), type: Date, format: "dd/mm/yyyy" };
        if (typeof v === "number") return { value: v, type: Number, format: k === "Montant" || k === "TVA" ? "#,##0.00" : "0" };
        return { value: String(v ?? "") };
      }),
    ),
  ];
  const cats = [
    head(["Catégorie", "Recettes", "Dépenses", "Solde", "Opérations"]),
    ...byCategory(txs, includeInternal).map((c) => [
      { value: c.category },
      { value: c.income, type: Number, format: "#,##0.00" },
      { value: c.expense, type: Number, format: "#,##0.00" },
      { value: c.income + c.expense, type: Number, format: "#,##0.00" },
      { value: c.count, type: Number },
    ]),
  ];
  const monthsSheet = [
    head(["Mois", "Recettes", "Dépenses", "Solde"]),
    ...byMonth(txs, months, includeInternal).map((m) => [
      { value: monthLabel(m.month, "long") },
      { value: m.income, type: Number, format: "#,##0.00" },
      { value: m.expense, type: Number, format: "#,##0.00" },
      { value: m.income + m.expense, type: Number, format: "#,##0.00" },
    ]),
  ];
  const blob = await writeXlsxFile([
    { data: ops, sheet: "Opérations", columns: [{ width: 12 }, { width: 42 }, { width: 20 }, { width: 22 }, { width: 12 }], stickyRowsCount: 1 },
    { data: cats, sheet: "Par catégorie", columns: [{ width: 26 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }], stickyRowsCount: 1 },
    { data: monthsSheet, sheet: "Par mois", columns: [{ width: 20 }, { width: 14 }, { width: 14 }, { width: 14 }], stickyRowsCount: 1 },
  ] as never).toBlob();
  save(blob, `compta-${stamp()}.xlsx`);
}

export async function exportPdf({ txs, months, periodLabel, includeInternal }: ExportInput) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  // jsPDF (polices standard) ne gère pas l'espace insécable fine de fr-FR.
  const m = (n: number) => money(n).replace(/[  ]/g, " ");
  const t = totals(txs, includeInternal);
  const blue: [number, number, number] = [42, 120, 214];

  doc.setFontSize(18).text("Synthèse comptable", 40, 50);
  doc.setFontSize(10).setTextColor(90).text(`Période : ${periodLabel} — édité le ${new Date().toLocaleDateString("fr-FR")}`, 40, 68);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 85,
    head: [["Recettes", "Dépenses", "Solde net", "Opérations"]],
    body: [[m(t.income), m(t.expense), m(t.net), String(t.count)]],
    theme: "grid",
    headStyles: { fillColor: blue },
    styles: { halign: "center", fontSize: 11 },
  });

  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
  autoTable(doc, {
    startY: y,
    head: [["Catégorie", "Recettes", "Dépenses", "Solde", "Nb"]],
    body: byCategory(txs, includeInternal).map((c) => [c.category, m(c.income), m(c.expense), m(c.income + c.expense), String(c.count)]),
    headStyles: { fillColor: blue },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    styles: { fontSize: 9 },
  });

  autoTable(doc, {
    head: [["Mois", "Recettes", "Dépenses", "Solde"]],
    body: byMonth(txs, months, includeInternal).map((x) => [monthLabel(x.month, "long"), m(x.income), m(x.expense), m(x.income + x.expense)]),
    headStyles: { fillColor: blue },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    styles: { fontSize: 9 },
  });

  doc.addPage();
  doc.setFontSize(14).text("Détail des opérations", 40, 50);
  autoTable(doc, {
    startY: 62,
    head: [["Date", "Libellé", "Catégorie", "Montant", "Statut"]],
    body: txs.map((x) => [
      new Date(x.date + "T00:00:00").toLocaleDateString("fr-FR"),
      x.merchant ? `${x.merchant} — ${x.label}` : x.label,
      x.category,
      m(x.amount),
      STATUS[x.status],
    ]),
    headStyles: { fillColor: blue },
    columnStyles: { 1: { cellWidth: 220 }, 3: { halign: "right" } },
    styles: { fontSize: 8, overflow: "linebreak" },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8).setTextColor(130).text(`${i} / ${pages}`, doc.internal.pageSize.getWidth() - 60, doc.internal.pageSize.getHeight() - 20);
  }
  doc.save(`compta-${stamp()}.pdf`);
}

export function exportJson({ txs }: ExportInput) {
  save(new Blob([JSON.stringify(txs, null, 2)], { type: "application/json" }), `operations-${stamp()}.json`);
}

/** Sauvegarde complète (ledger + corrections + règles) pour archivage ou migration. */
export function exportBackup(ledger: Ledger, overrides: Overrides, rules: Rules) {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ledger, overrides, rules }, null, 2)], {
    type: "application/json",
  });
  save(blob, `compta-sauvegarde-${stamp()}.json`);
}

/** Format OFX 2 : réimportable dans la plupart des logiciels (Actual, Firefly III, GnuCash, Excel…). */
export function exportOfx({ txs }: ExportInput) {
  const d = (s: string) => s.replace(/-/g, "");
  const esc = (s: string) => s.replace(/[<>&]/g, " ");
  const body = txs
    .map(
      (t) =>
        `<STMTTRN><TRNTYPE>${t.amount < 0 ? "DEBIT" : "CREDIT"}</TRNTYPE><DTPOSTED>${d(t.date)}</DTPOSTED><TRNAMT>${t.amount.toFixed(2)}</TRNAMT><FITID>${t.id}</FITID><NAME>${esc((t.merchant || t.label).slice(0, 32))}</NAME><MEMO>${esc(t.category)}</MEMO></STMTTRN>`,
    )
    .join("\n");
  const ofx = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><TRNUID>1</TRNUID><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
<STMTRS><CURDEF>EUR</CURDEF><BANKACCTFROM><BANKID>COMPTA</BANKID><ACCTID>COMPTA</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST>
${body}
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  save(new Blob([ofx], { type: "application/x-ofx" }), `compta-${stamp()}.ofx`);
}
