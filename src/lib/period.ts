import type { Transaction } from "../../shared/schema";

export type PeriodPreset = "this-month" | "last-month" | "this-year" | "last-year" | "last-12" | "all" | "custom";

export interface Period {
  preset: PeriodPreset;
  from?: string; // YYYY-MM-DD inclus
  to?: string;
}

export const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "this-month", label: "Ce mois-ci" },
  { value: "last-month", label: "Mois dernier" },
  { value: "last-12", label: "12 derniers mois" },
  { value: "this-year", label: "Cette année" },
  { value: "last-year", label: "Année dernière" },
  { value: "all", label: "Tout" },
  { value: "custom", label: "Personnalisée…" },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function resolvePeriod(p: Period, now = new Date()): { from: string | null; to: string | null } {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (p.preset) {
    case "this-month": return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "last-month": return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "last-12": return { from: iso(new Date(y, m - 11, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "this-year": return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "last-year": return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "custom": return { from: p.from || null, to: p.to || null };
    default: return { from: null, to: null };
  }
}

export function inPeriod(t: Transaction, r: { from: string | null; to: string | null }) {
  return (!r.from || t.date >= r.from) && (!r.to || t.date <= r.to);
}

export function periodLabel(p: Period): string {
  if (p.preset !== "custom") return PRESETS.find((x) => x.value === p.preset)!.label;
  return `${p.from ?? "…"} → ${p.to ?? "…"}`;
}

/** Liste des mois YYYY-MM entre deux dates (au moins `min` mois, finissant à `to`). */
export function monthsBetween(from: string | null, to: string | null, fallbackDates: string[], min = 6): string[] {
  const end = to ?? fallbackDates.reduce((a, b) => (b > a ? b : a), iso(new Date()));
  let start = from ?? fallbackDates.reduce((a, b) => (b < a ? b : a), end);
  const endD = new Date(end.slice(0, 7) + "-01T00:00:00");
  const minStart = new Date(endD.getFullYear(), endD.getMonth() - (min - 1), 1);
  if (new Date(start.slice(0, 7) + "-01T00:00:00") > minStart) start = iso(minStart);
  const out: string[] = [];
  const d = new Date(start.slice(0, 7) + "-01T00:00:00");
  while (d <= endD && out.length < 120) {
    out.push(iso(d).slice(0, 7));
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}
