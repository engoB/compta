import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { inPeriod, monthsBetween, periodLabel, resolvePeriod } from "../lib/period";
import { exportBackup, exportCsv, exportJson, exportOfx, exportPdf, exportXlsx, type ExportInput } from "../lib/export";
import { INTERNAL } from "../lib/stats";
import { PeriodPicker } from "../components/PeriodPicker";
import { Section } from "../components/ui";
import { Icon } from "../components/Icon";

const FORMATS: { id: string; title: string; desc: string; run: (i: ExportInput) => void | Promise<void> }[] = [
  { id: "xlsx", title: "Excel (.xlsx)", desc: "Opérations + synthèses par catégorie et par mois, prêtes à filtrer.", run: exportXlsx },
  { id: "pdf", title: "Rapport PDF", desc: "Synthèse imprimable : totaux, catégories, mois et détail.", run: exportPdf },
  { id: "csv", title: "CSV", desc: "Format universel (séparateur ;) — Excel, Numbers, Google Sheets, logiciel comptable.", run: exportCsv },
  { id: "ofx", title: "OFX", desc: "Réimport dans Actual Budget, Firefly III, GnuCash, Money…", run: exportOfx },
  { id: "json", title: "JSON", desc: "Données brutes des opérations filtrées.", run: exportJson },
];

export function Exports() {
  const { transactions, period, rules, ledger, overrides } = useStore();
  const [category, setCategory] = useState("");
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [includeInternal, setIncludeInternal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const range = resolvePeriod(period);

  const txs = useMemo(
    () =>
      transactions
        .filter((t) => inPeriod(t, range) && (!category || t.category === category) && (!onlyVerified || t.status === "verified") && (includeInternal || t.category !== INTERNAL))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [transactions, range.from, range.to, category, onlyVerified, includeInternal],
  );
  const months = monthsBetween(range.from, range.to, txs.map((t) => t.date), 1);
  const input: ExportInput = { txs, months, periodLabel: periodLabel(period), includeInternal };

  async function run(id: string, fn: (i: ExportInput) => void | Promise<void>) {
    setBusy(id);
    try {
      await fn(input);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Exports</h1>
      <Section title="Contenu">
        <div className="flex flex-wrap items-center gap-3">
          <PeriodPicker />
          <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie">
            <option value="">Toutes catégories</option>
            {rules.categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-ink2"><input type="checkbox" checked={onlyVerified} onChange={(e) => setOnlyVerified(e.target.checked)} /> Vérifiées uniquement</label>
          <label className="flex items-center gap-1.5 text-sm text-ink2"><input type="checkbox" checked={includeInternal} onChange={(e) => setIncludeInternal(e.target.checked)} /> Virements internes</label>
        </div>
        <p className="mt-3 text-sm text-ink2">{txs.length} opération(s) seront exportées.</p>
      </Section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FORMATS.map((f) => (
          <button key={f.id} className="card flex flex-col items-start gap-1 p-4 text-left hover:bg-s2 disabled:opacity-50" disabled={!txs.length || !!busy} onClick={() => run(f.id, f.run)}>
            <span className="flex items-center gap-2 font-medium"><Icon name="download" className="size-4 text-accent" /> {f.title}{busy === f.id && "…"}</span>
            <span className="text-sm text-ink2">{f.desc}</span>
          </button>
        ))}
        <button className="card flex flex-col items-start gap-1 p-4 text-left hover:bg-s2" onClick={() => exportBackup(ledger, overrides, rules)}>
          <span className="flex items-center gap-2 font-medium"><Icon name="download" className="size-4 text-accent" /> Sauvegarde complète</span>
          <span className="text-sm text-ink2">Toutes les données, corrections et règles (JSON).</span>
        </button>
      </div>
    </div>
  );
}
