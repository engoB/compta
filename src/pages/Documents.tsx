import { useEffect, useRef, useState } from "react";
import type { DocumentRecord } from "../../shared/schema";
import { useStore } from "../lib/store";
import { money, relativeTime, shortDate } from "../lib/format";
import { openDocument } from "../lib/docs";
import { Empty, Section, StatusChip } from "../components/ui";
import { Icon } from "../components/Icon";

const KIND: Record<DocumentRecord["kind"], string> = {
  bank_statement: "Relevé bancaire", receipt: "Ticket", invoice: "Facture", csv: "Export CSV", ofx: "Export OFX", other: "Autre",
};

export function Documents() {
  const { ledger, uploads, addFiles, runNow, run, pollRun, settings, setError, online, demo } = useStore();
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!demo) void pollRun();
  }, [demo, pollRun]);

  const docs = [...ledger.documents]
    .sort((a, b) => b.processedAt.localeCompare(a.processedAt))
    .filter((d) => filter === "all" || d.status !== "processed");
  const attention = ledger.documents.filter((d) => d.status !== "processed").length;
  const running = run && run.status !== "completed";

  const onPick = (list: FileList | null) => {
    if (list?.length) void addFiles(list);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Justificatifs</h1>

      <div
        className={`card border-2 border-dashed p-5 text-center transition ${dragging ? "border-accent bg-accent/5" : "border-line"}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onPick(e.dataTransfer.files); }}
      >
        <p className="mb-3 text-sm text-ink2">
          Relevés PDF, photos de tickets, factures, exports CSV/OFX de ta banque.
          <span className="hidden sm:inline"> Glisse-dépose ici ou :</span>
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn-primary" onClick={() => camera.current?.click()}><Icon name="camera" className="size-4" /> Photographier un ticket</button>
          <button className="btn-ghost" onClick={() => files.current?.click()}><Icon name="upload" className="size-4" /> Importer des fichiers</button>
        </div>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
        <input ref={files} type="file" multiple accept=".pdf,.csv,.ofx,.qfx,.txt,image/*" hidden onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
        {uploads.length > 0 && (
          <p className="mt-3 text-xs text-warn">
            {uploads.length} fichier(s) en attente d'envoi{online ? "…" : " (hors-ligne — envoi automatique au retour du réseau)"}
          </p>
        )}
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-3 text-sm">
        <Icon name="refresh" className={`size-4 text-ink2 ${running ? "animate-spin" : ""}`} />
        <span className="text-ink2">
          {running ? "Analyse en cours sur GitHub Actions…" : run ? `Dernière exécution ${relativeTime(run.created_at)} — ${run.conclusion === "success" ? "réussie" : run.conclusion ?? run.status}` : "Chaque dépôt déclenche l'analyse ; une passe complète a lieu chaque jour."}
          {run?.html_url && <> · <a className="text-accent hover:underline" href={run.html_url} target="_blank" rel="noreferrer">journal</a></>}
        </span>
        <button className="btn-ghost ml-auto" onClick={runNow} disabled={!!running}><Icon name="play" className="size-4" /> Analyser maintenant</button>
      </div>

      <Section
        title={`Documents analysés (${ledger.documents.length})`}
        action={
          <div className="flex rounded-xl border border-line p-0.5 text-xs">
            <button className={`rounded-lg px-2.5 py-1 ${filter === "all" ? "bg-s2 font-medium" : "text-ink2"}`} onClick={() => setFilter("all")}>Tous</button>
            <button className={`rounded-lg px-2.5 py-1 ${filter === "attention" ? "bg-s2 font-medium" : "text-ink2"}`} onClick={() => setFilter("attention")}>À traiter ({attention})</button>
          </div>
        }
      >
        {docs.length === 0 ? (
          <Empty>Aucun document.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {docs.map((d) => (
              <li key={d.id} className="py-3">
                <button className="flex w-full items-start gap-3 text-left" onClick={() => setOpen(open === d.id ? null : d.id)}>
                  <Icon name="file" className="mt-0.5 size-5 shrink-0 text-ink2" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{d.issuer || d.filename}</span>
                      <StatusChip status={d.status === "to_review" ? "to_review" : d.status} />
                    </div>
                    <div className="truncate text-xs text-mute">
                      {KIND[d.kind]}
                      {d.periodStart && d.periodEnd ? ` · ${shortDate(d.periodStart)} → ${shortDate(d.periodEnd)}` : d.documentDate ? ` · ${shortDate(d.documentDate)}` : ""}
                      {d.total != null && ` · ${money(d.total)}`}
                      {` · ${d.transactionIds.length} op.`}
                    </div>
                  </div>
                  <Icon name="chevron" className={`size-4 shrink-0 text-mute transition ${open === d.id ? "rotate-90" : ""}`} />
                </button>
                {open === d.id && (
                  <div className="mt-2 space-y-2 pl-8 text-xs">
                    {d.error && <p className="text-bad">{d.error}</p>}
                    {d.checks.length > 0 && (
                      <ul className="space-y-1">
                        {d.checks.map((c) => (
                          <li key={c.name} className="flex items-start gap-1.5">
                            <Icon name={c.ok ? "check" : "alert"} className={`mt-px size-3.5 shrink-0 ${c.ok ? "text-good" : "text-warn"}`} />
                            <span><b className="font-medium">{c.name}</b> — <span className="text-ink2">{c.detail}</span></span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {d.notes && <p className="text-ink2">Note de l'IA : {d.notes}</p>}
                    <p className="text-mute">
                      {d.filename} · analysé {relativeTime(d.processedAt)}{d.model && ` · ${d.model}`}{d.costUsd != null && ` · ${d.costUsd.toFixed(4)} $`}
                    </p>
                    <button
                      className="btn-ghost text-xs"
                      onClick={() => settings?.token ? openDocument(settings, d.path).catch((e) => setError(e.message)) : setError("Mode démo : aucun fichier réel.")}
                    >
                      <Icon name="eye" className="size-4" /> Ouvrir le fichier
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
