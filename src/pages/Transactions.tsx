import { useEffect, useMemo, useState } from "react";
import type { Transaction } from "../../shared/schema";
import { normalizeLabel } from "../../shared/view";
import { useStore } from "../lib/store";
import { inPeriod, resolvePeriod } from "../lib/period";
import { totals } from "../lib/stats";
import { money, shortDate, signedMoney } from "../lib/format";
import { PeriodPicker } from "../components/PeriodPicker";
import { Empty, StatusChip } from "../components/ui";
import { Icon } from "../components/Icon";
import { newManualTx, TxEditor } from "../components/TxEditor";

export interface TxFilters {
  category?: string;
  status?: Transaction["status"] | "";
}

const PAGE = 100;

export function Transactions({ initial }: { initial?: TxFilters }) {
  const { transactions, period, rules, apply } = useStore();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [status, setStatus] = useState<string>(initial?.status ?? "");
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<{ tx: Transaction; isNew?: boolean } | null>(null);

  useEffect(() => {
    setCategory(initial?.category ?? "");
    setStatus(initial?.status ?? "");
  }, [initial]);

  const range = resolvePeriod(period);
  const filtered = useMemo(() => {
    const nq = normalizeLabel(q);
    return transactions.filter(
      (t) =>
        inPeriod(t, range) &&
        (!category || t.category === category) &&
        (!status || t.status === status) &&
        (!nq || normalizeLabel(`${t.label} ${t.merchant ?? ""} ${t.notes ?? ""}`).includes(nq) || String(Math.abs(t.amount)).includes(q.replace(",", "."))),
    );
  }, [transactions, range.from, range.to, category, status, q]);

  const tot = totals(filtered, true);
  const unverified = filtered.filter((t) => t.status !== "verified");
  const usedCats = [...new Set([...rules.categories, ...transactions.map((t) => t.category)])];

  function validateAll() {
    if (!confirm(`Valider ${unverified.length} opération(s) ?`)) return;
    apply(unverified.map((t) => ({ kind: "edit" as const, id: t.id, patch: { status: "verified" as const } })));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Opérations</h1>
        <div className="flex gap-2">
          {unverified.length > 0 && (
            <button className="btn-ghost" onClick={validateAll}><Icon name="check" className="size-4" /> Tout valider ({unverified.length})</button>
          )}
          <button className="btn-primary" onClick={() => setEditing({ tx: newManualTx(), isNew: true })}>
            <Icon name="plus" className="size-4" /> Ajouter
          </button>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-48 flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mute" />
          <input className="input pl-9" placeholder="Rechercher libellé, marchand, montant…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <PeriodPicker />
        <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie">
          <option value="">Toutes catégories</option>
          {usedCats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
          <option value="">Tous statuts</option>
          <option value="to_review">À vérifier</option>
          <option value="auto">Automatiques</option>
          <option value="verified">Vérifiées</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 px-1 text-sm text-ink2 num">
        <span>{filtered.length} opération(s)</span>
        <span>Recettes <b className="text-ink">{money(tot.income)}</b></span>
        <span>Dépenses <b className="text-ink">{money(tot.expense)}</b></span>
        <span>Solde <b className="text-ink">{signedMoney(tot.net)}</b></span>
      </div>

      {filtered.length === 0 ? (
        <div className="card"><Empty>Aucune opération ne correspond aux filtres.</Empty></div>
      ) : (
        <>
          {/* Mobile : cartes */}
          <ul className="card divide-y divide-line md:hidden">
            {filtered.slice(0, limit).map((t) => (
              <li key={t.id}>
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-s2" onClick={() => setEditing({ tx: t })}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{t.merchant || t.label}</span>
                      {t.receiptIds.length > 0 && <Icon name="paperclip" className="size-3.5 shrink-0 text-mute" />}
                    </div>
                    <div className="truncate text-xs text-mute">{shortDate(t.date)} · {t.category}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`num text-sm font-medium ${t.amount > 0 ? "text-good" : ""}`}>{signedMoney(t.amount, t.currency)}</span>
                    {t.status !== "auto" && <StatusChip status={t.status} />}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* Bureau : tableau */}
          <div className="card hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-s2/60 text-left text-xs text-ink2">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-2 py-2.5 font-medium">Libellé</th>
                  <th className="px-2 py-2.5 font-medium">Catégorie</th>
                  <th className="px-2 py-2.5 text-right font-medium">Montant</th>
                  <th className="px-2 py-2.5 font-medium">Statut</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.slice(0, limit).map((t) => (
                  <tr key={t.id} className="cursor-pointer hover:bg-s2/50" onClick={() => setEditing({ tx: t })}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink2 num">{shortDate(t.date)}</td>
                    <td className="max-w-md px-2 py-2.5">
                      <div className="truncate font-medium">{t.merchant || t.label}</div>
                      {t.merchant && <div className="truncate text-xs text-mute">{t.label}</div>}
                    </td>
                    <td className="px-2 py-2.5 text-ink2">{t.category}</td>
                    <td className={`whitespace-nowrap px-2 py-2.5 text-right font-medium num ${t.amount > 0 ? "text-good" : ""}`}>{signedMoney(t.amount, t.currency)}</td>
                    <td className="px-2 py-2.5"><StatusChip status={t.status} /></td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {t.receiptIds.length > 0 && <span title="Justificatif rapproché"><Icon name="paperclip" className="size-4 text-mute" /></span>}
                        {t.status !== "verified" && (
                          <button
                            className="rounded-lg p-1 text-ink2 hover:bg-good/15 hover:text-good"
                            title="Valider"
                            onClick={(e) => {
                              e.stopPropagation();
                              apply([{ kind: "edit", id: t.id, patch: { status: "verified" } }]);
                            }}
                          >
                            <Icon name="check" className="size-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length > limit && (
            <div className="text-center">
              <button className="btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>Afficher plus ({filtered.length - limit} restantes)</button>
            </div>
          )}
        </>
      )}
      {editing && <TxEditor tx={editing.tx} isNew={editing.isNew} onClose={() => setEditing(null)} />}
    </div>
  );
}
