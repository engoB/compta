const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const eurCompact = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 });

export const money = (n: number, currency = "EUR") =>
  currency === "EUR" ? eur.format(n) : new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(n);

export const signedMoney = (n: number, currency?: string) => (n > 0 ? "+" : "") + money(n, currency);

export const compactMoney = (n: number) => (Math.abs(n) >= 10_000 ? eurCompact.format(n) : eur.format(Math.round(n)));

export const shortDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });

export const monthLabel = (ym: string, style: "short" | "long" = "short") =>
  new Date(ym + "-01T00:00:00").toLocaleDateString("fr-FR", { month: style, year: style === "long" ? "numeric" : "2-digit" });

export function relativeTime(iso: string): string {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  return rtf.format(-Math.round(diff / 86400), "day");
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
