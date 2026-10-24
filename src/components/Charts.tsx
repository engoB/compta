import { useLayoutEffect, useRef, useState } from "react";
import { monthLabel, money } from "../lib/format";

const tick = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k€` : `${Math.round(n)} €`);

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Colonne à extrémité arrondie (4 px), carrée sur la ligne de base. */
function colPath(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(v: number) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function MonthlyChart({ data }: { data: { month: string; income: number; expense: number }[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const H = 220;
  const pad = { l: 52, r: 8, t: 12, b: 26 };
  const innerW = Math.max(10, width - pad.l - pad.r);
  const innerH = H - pad.t - pad.b;
  const max = niceMax(Math.max(...data.map((d) => Math.max(d.income, -d.expense)), 0));
  const band = innerW / Math.max(1, data.length);
  const barW = Math.max(3, Math.min(24, (band - 10) / 2));
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 44)));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-ink2">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--series-1)" }} />Recettes</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "var(--series-2)" }} />Dépenses</span>
        <button className="ml-auto text-accent hover:underline" onClick={() => setTable((t) => !t)}>{table ? "Graphique" : "Tableau"}</button>
      </div>
      {table ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm num">
            <thead className="text-left text-xs text-ink2"><tr><th className="py-1">Mois</th><th className="text-right">Recettes</th><th className="text-right">Dépenses</th><th className="text-right">Solde</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.month} className="border-t border-line">
                  <td className="py-1.5">{monthLabel(d.month, "long")}</td>
                  <td className="text-right">{money(d.income)}</td>
                  <td className="text-right">{money(d.expense)}</td>
                  <td className="text-right font-medium">{money(d.income + d.expense)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative w-full min-w-0" onMouseLeave={() => setHover(null)}>
          <svg className="block" width={width} height={H} role="img" aria-label="Recettes et dépenses par mois">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
                <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)">{tick(t)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = pad.l + band * i + band / 2;
              const inc = Math.max(0, d.income);
              const exp = Math.max(0, -d.expense);
              return (
                <g key={d.month}>
                  {hover === i && <rect x={pad.l + band * i} y={pad.t} width={band} height={innerH} fill="var(--surface-2)" opacity={0.6} />}
                  <path d={colPath(cx - barW - 1, y(inc), barW, y(0) - y(inc))} fill="var(--series-1)" />
                  <path d={colPath(cx + 1, y(exp), barW, y(0) - y(exp))} fill="var(--series-2)" />
                  {i % labelEvery === 0 && (
                    <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{monthLabel(d.month)}</text>
                  )}
                  <rect
                    x={pad.l + band * i} y={pad.t} width={band} height={innerH} fill="transparent"
                    onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}
                  />
                </g>
              );
            })}
          </svg>
          {width > 0 && hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute top-1 z-10 w-44 rounded-xl border border-line bg-s1 p-2.5 text-xs shadow-lg"
              style={{ left: Math.min(Math.max(0, pad.l + band * hover + band / 2 - 88), width - 176) }}
            >
              <div className="mb-1 font-medium text-ink">{monthLabel(data[hover].month, "long")}</div>
              <Row color="var(--series-1)" label="Recettes" value={money(data[hover].income)} />
              <Row color="var(--series-2)" label="Dépenses" value={money(data[hover].expense)} />
              <div className="mt-1 flex justify-between border-t border-line pt-1 font-medium num"><span>Solde</span><span>{money(data[hover].income + data[hover].expense)}</span></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-ink2">
      <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: color }} />{label}</span>
      <span className="num text-ink">{value}</span>
    </div>
  );
}

/** Dépenses par catégorie : barres horizontales, valeur et part en texte. */
export function CategoryBars({ data, onSelect }: { data: { category: string; value: number; count: number }[]; onSelect?: (c: string) => void }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.category}>
          <button className="group w-full text-left" onClick={() => onSelect?.(d.category)} title={`${d.count} opération(s)`}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-ink group-hover:underline">{d.category}</span>
              <span className="shrink-0 num text-ink">
                {money(d.value)} <span className="text-xs text-mute">{total ? Math.round((d.value / total) * 100) : 0} %</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-s2">
              <div className="h-2 rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: "var(--series-2)" }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
