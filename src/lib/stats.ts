import type { Transaction } from "../../shared/schema";

export const INTERNAL = "Virements internes";

export interface Totals {
  income: number;
  expense: number; // négatif
  net: number;
  count: number;
}

export function totals(txs: Transaction[], includeInternal = false): Totals {
  let income = 0;
  let expense = 0;
  let count = 0;
  for (const t of txs) {
    if (!includeInternal && t.category === INTERNAL) continue;
    count++;
    if (t.amount >= 0) income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, net: income + expense, count };
}

export function byCategory(txs: Transaction[], includeInternal = false) {
  const map = new Map<string, { category: string; income: number; expense: number; count: number }>();
  for (const t of txs) {
    if (!includeInternal && t.category === INTERNAL) continue;
    const e = map.get(t.category) ?? { category: t.category, income: 0, expense: 0, count: 0 };
    if (t.amount >= 0) e.income += t.amount;
    else e.expense += t.amount;
    e.count++;
    map.set(t.category, e);
  }
  return [...map.values()].sort((a, b) => a.expense - b.expense || b.income - a.income);
}

export function byMonth(txs: Transaction[], months: string[], includeInternal = false) {
  const map = new Map(months.map((m) => [m, { month: m, income: 0, expense: 0 }]));
  for (const t of txs) {
    if (!includeInternal && t.category === INTERNAL) continue;
    const e = map.get(t.date.slice(0, 7));
    if (!e) continue;
    if (t.amount >= 0) e.income += t.amount;
    else e.expense += t.amount;
  }
  return [...map.values()];
}
