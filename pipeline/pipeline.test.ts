import { describe, expect, it } from "vitest";
import { parseBankCsv, parseOfx } from "./parsers";
import { parseAmount, parseDate } from "./util";
import { runChecks } from "./checks";
import { isDuplicate, reconcileReceipts, statementTxId } from "./reconcile";
import { categorize, compileRules, learnFromOverrides } from "./categorize";
import { consolidate } from "../shared/view";
import { emptyLedger, emptyOverrides, type Transaction } from "../shared/schema";
import type { Extraction } from "./extract";

const tx = (p: Partial<Transaction>): Transaction => ({
  id: "t_x", date: "2026-03-10", label: "CB TEST", amount: -10, currency: "EUR", category: "Autre",
  receiptIds: [], mergedFrom: [], status: "auto", ...p,
});

describe("formats", () => {
  it("lit les montants français", () => {
    expect(parseAmount("1 234,56 €")).toBe(1234.56);
    expect(parseAmount("-12.30")).toBe(-12.3);
    expect(parseAmount("(45,00)")).toBe(-45);
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("")).toBeNull();
  });
  it("lit les dates", () => {
    expect(parseDate("05/03/2026")).toBe("2026-03-05");
    expect(parseDate("05-03-26")).toBe("2026-03-05");
    expect(parseDate("20260305120000")).toBe("2026-03-05");
    expect(parseDate("31/02/2026")).toBeNull();
  });
});

describe("parsers déterministes", () => {
  it("CSV avec colonnes débit/crédit et préambule", () => {
    const csv = `Compte courant;FR76...\n\nDate;Libellé;Débit;Crédit\n02/03/2026;CB CARREFOUR;45,10;\n03/03/2026;VIR SALAIRE;;2 500,00\n`;
    expect(parseBankCsv(csv)).toEqual([
      { date: "2026-03-02", label: "CB CARREFOUR", amount: -45.1 },
      { date: "2026-03-03", label: "VIR SALAIRE", amount: 2500 },
    ]);
  });
  it("CSV montant signé (séparateur ,)", () => {
    const csv = `Date,Description,Amount\n2026-03-02,NETFLIX,-13.49\n`;
    expect(parseBankCsv(csv)).toEqual([{ date: "2026-03-02", label: "NETFLIX", amount: -13.49 }]);
  });
  it("CSV non reconnu → null", () => {
    expect(parseBankCsv("a;b;c\n1;2;3")).toBeNull();
  });
  it("OFX SGML", () => {
    const ofx = `<OFX><ACCTID>123\n<BANKTRANLIST>\n<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20260302\n<TRNAMT>-45.10\n<NAME>CB CARREFOUR\n</STMTTRN>\n<STMTTRN>\n<DTPOSTED>20260303\n<TRNAMT>2500.00\n<NAME>VIR SALAIRE\n<MEMO>ACME\n</STMTTRN>\n</BANKTRANLIST>`;
    expect(parseOfx(ofx)).toEqual([
      { date: "2026-03-02", label: "CB CARREFOUR", amount: -45.1, account: "123" },
      { date: "2026-03-03", label: "VIR SALAIRE — ACME", amount: 2500, account: "123" },
    ]);
  });
});

describe("contrôles", () => {
  const base: Extraction = {
    documentType: "bank_statement", issuer: "Banque", accountLabel: null, documentDate: null,
    periodStart: "2026-03-01", periodEnd: "2026-03-31", currency: "EUR", openingBalance: 100, closingBalance: 54.9,
    total: null, totalVat: null, notes: null, confidence: 0.95,
    transactions: [
      { date: "2026-03-02", label: "CB", merchant: null, amount: -45.1, category: "Alimentation", paymentMethod: "carte", vatRate: null, vatAmount: null },
    ],
  };
  it("réconcilie les soldes", () => {
    expect(runChecks(base, "2026-10-01").blocking).toHaveLength(0);
  });
  it("détecte une ligne manquante", () => {
    const r = runChecks({ ...base, closingBalance: 20 }, "2026-10-01");
    expect(r.blocking.map((c) => c.name)).toContain("Rapprochement des soldes");
  });
  it("vérifie le total d'un ticket", () => {
    const r = runChecks({ ...base, documentType: "receipt", openingBalance: null, closingBalance: null, total: 40 }, "2026-10-01");
    expect(r.blocking.map((c) => c.name)).toContain("Total du justificatif");
  });
});

describe("dédoublonnage et rapprochement", () => {
  it("id stable entre relevés", () => {
    expect(statementTxId("2026-03-02", -45.1, "CB CARREFOUR 01/03", 0)).toBe(statementTxId("2026-03-02", -45.1, "CB  Carrefour", 0));
  });
  it("détecte un doublon issu d'un autre relevé", () => {
    const a = tx({ id: "t_a", docId: "d1", label: "CB CARREFOUR MARKET PARIS" });
    const b = tx({ id: "t_b", docId: "d2", label: "CARREFOUR MARKET PARIS" });
    expect(isDuplicate(b, [a])).toBe(true);
    expect(isDuplicate(tx({ id: "t_c", docId: "d2", amount: -11 }), [a])).toBe(false);
  });
  it("fusionne un ticket dans la ligne bancaire", () => {
    const bank = tx({ id: "t_b", date: "2026-03-12", label: "CB LIDL 11/03", amount: -23.4, docId: "s1" });
    const receipt = tx({ id: "r_d9", date: "2026-03-11", label: "Courses", merchant: "Lidl", amount: -23.4, docId: "d9", receiptIds: ["d9"], vatAmount: 1.2, category: "Alimentation" });
    const { txs, matched } = reconcileReceipts([bank, receipt]);
    expect(matched).toBe(1);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ id: "t_b", receiptIds: ["d9"], mergedFrom: ["r_d9"], vatAmount: 1.2, category: "Alimentation", merchant: "Lidl" });
  });
});

describe("catégorisation et corrections", () => {
  it("règles > apprentissage > IA", () => {
    const ledger = { ...emptyLedger(), transactions: [tx({ id: "t_1", label: "CB BOULANGERIE DUPONT" })] };
    const overrides = { ...emptyOverrides(), edits: { t_1: { category: "Alimentation" } } };
    const learned = learnFromOverrides(ledger, overrides);
    const rules = compileRules({ categories: [], rules: [{ pattern: "sncf", category: "Transport" }] });
    expect(categorize(tx({ label: "CB BOULANGERIE DUPONT 12/03" }), rules, learned).category).toBe("Alimentation");
    expect(categorize(tx({ label: "SNCF CONNECT" }), rules, learned).category).toBe("Transport");
    expect(categorize(tx({ label: "AUTRE CHOSE", category: "Loisirs" }), rules, learned).category).toBe("Loisirs");
  });
  it("les corrections suivent une opération fusionnée", () => {
    const ledger = { ...emptyLedger(), transactions: [tx({ id: "t_b", mergedFrom: ["r_1"] })] };
    const overrides = { ...emptyOverrides(), edits: { r_1: { notes: "repas client" } }, added: [tx({ id: "m_1", label: "Espèces" })] };
    const view = consolidate(ledger, overrides);
    expect(view.find((t) => t.id === "t_b")?.notes).toBe("repas client");
    expect(view).toHaveLength(2);
    expect(consolidate(ledger, { ...overrides, deleted: ["t_b"] })).toHaveLength(1);
  });
});
