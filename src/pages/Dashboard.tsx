import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { inPeriod, monthsBetween, periodLabel, resolvePeriod } from "../lib/period";
import { byCategory, byMonth, totals } from "../lib/stats";
import { money, relativeTime, shortDate, signedMoney } from "../lib/format";
import { CategoryBars, MonthlyChart } from "../components/Charts";
import { PeriodPicker } from "../components/PeriodPicker";
import { Empty, Section, StatusChip } from "../components/ui";
import { Icon } from "../components/Icon";
import { TxEditor } from "../components/TxEditor";
import type { Transaction } from "../../shared/schema";
import type { Nav } from "../App";

export function Dashboard({ nav }: { nav: Nav }) {
  const { transactions, period, lastRun, ledger, runNow, run } = useStore();
  const [includeInternal, setIncludeInternal] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const range = resolvePeriod(period);
  const txs = useMemo(() => transactions.filter((t) => inPeriod(t, range)), [transactions, range.from, range.to]);
  const t = totals(txs, includeInternal);
  const months = useMemo(() => monthsBetween(range.from, range.to, transactions.map((x) => x.date)), [range.from, range.to, transactions]);
  const monthly = useMemo(() => byMonth(transactions.filter((x) => x.date.slice(0, 7) >= months[0]), months, includeInternal), [transactions, months, includeInternal]);
  const cats = byCategory(txs, includeInternal)
    .filter((c) => c.expense < 0)
    .map((c) => ({ category: c.category, value: -c.expense, count: c.count }));
  const toReview = transactions.filter((x) => x.status === "to_review").length;
  const docsToReview = ledger.documents.filter((d) => d.status !== "processed").length;
  const running = run && run.status !== "completed";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
          <p className="text-sm text-ink2">{periodLabel(period)} · {txs.length} opération(s)</p>
        </div>
        <PeriodPicker />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Solde net" value={signedMoney(t.net)} hero />
        <Stat label="Recettes" value={money(t.income)} swatch="var(--series-1)" />
        <Stat label="Dépenses" value={money(t.expense)} swatch="var(--series-2)" />
        <button className="card col-span-2 p-4 text-left hover:bg-s2 lg:col-span-1" onClick={() => nav("operations", { status: "to_review" })}>
          <div className="text-xs text-ink2">À vérifier</div>
          <div className="mt-1 flex items-center gap-2 text-2xl font-semibold num">
            {toReview}
            {toReview > 0 && <Icon name="alert" className="size-5 text-warn" />}
          </div>
          <div className="mt-0.5 text-xs text-mute">{docsToReview} document(s) signalé(s)</div>
        </button>
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-3 text-sm">
        <Icon name="refresh" className={`size-4 text-ink2 ${running ? "animate-spin" : ""}`} />
        <span className="text-ink2">
          {running
            ? "Analyse en cours…"
            : lastRun
              ? <>Dernière passe {relativeTime(lastRun.at)} : {lastRun.processed} traité(s), {lastRun.toReview} à vérifier, {lastRun.matched} ticket(s) rapproché(s) · {lastRun.costUsd.toFixed(3)} $</>
              : "Aucune passe d'analyse pour l'instant."}
        </span>
        <button className="btn-ghost ml-auto" onClick={runNow} disabled={!!running}>
          <Icon name="play" className="size-4" /> Analyser maintenant
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Section title="Recettes et dépenses par mois" className="lg:col-span-3"
          action={
            <label className="flex items-center gap-1.5 text-xs text-ink2">
              <input type="checkbox" checked={includeInternal} onChange={(e) => setIncludeInternal(e.target.checked)} />
              Virements internes
            </label>
          }>
          <MonthlyChart data={monthly} />
        </Section>
        <Section title="Dépenses par catégorie" className="lg:col-span-2">
          {cats.length ? <CategoryBars data={cats.slice(0, 8)} onSelect={(c) => nav("operations", { category: c })} /> : <Empty>Aucune dépense sur la période.</Empty>}
        </Section>
      </div>

      <Section title="Dernières opérations" action={<button className="text-sm text-accent hover:underline" onClick={() => nav("operations")}>Tout voir</button>}>
        {txs.length ? (
          <ul className="divide-y divide-line">
            {txs.slice(0, 6).map((x) => (
              <li key={x.id}>
                <button className="flex w-full items-center gap-3 py-2.5 text-left" onClick={() => setEditing(x)}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{x.merchant || x.label}</div>
                    <div className="text-xs text-mute">{shortDate(x.date)} · {x.category}</div>
                  </div>
                  {x.status === "to_review" && <StatusChip status="to_review" />}
                  <span className={`num text-sm font-medium ${x.amount > 0 ? "text-good" : ""}`}>{signedMoney(x.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Dépose tes premiers relevés dans l'onglet Justificatifs.</Empty>
        )}
      </Section>
      <TxEditor tx={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Stat({ label, value, swatch, hero }: { label: string; value: string; swatch?: string; hero?: boolean }) {
  return (
    <div className={`card p-4 ${hero ? "col-span-2 lg:col-span-1" : ""}`}>
      <div className="flex items-center gap-1.5 text-xs text-ink2">
        {swatch && <span className="size-2 rounded-sm" style={{ background: swatch }} />}
        {label}
      </div>
      <div className={`mt-1 font-semibold num tracking-tight ${hero ? "text-3xl" : "text-xl sm:text-2xl"}`}>{value}</div>
    </div>
  );
}
