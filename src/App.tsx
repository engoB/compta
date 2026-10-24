import { useCallback, useEffect, useState } from "react";
import { useStore } from "./lib/store";
import { Icon, type IconName } from "./components/Icon";
import { Dashboard } from "./pages/Dashboard";
import { Transactions, type TxFilters } from "./pages/Transactions";
import { Documents } from "./pages/Documents";
import { Exports } from "./pages/Exports";
import { Settings } from "./pages/Settings";

type Page = "dashboard" | "operations" | "documents" | "exports" | "settings";
export type Nav = (page: Page, filters?: TxFilters) => void;

const PAGES: { id: Page; label: string; icon: IconName }[] = [
  { id: "dashboard", label: "Accueil", icon: "home" },
  { id: "operations", label: "Opérations", icon: "list" },
  { id: "documents", label: "Justificatifs", icon: "file" },
  { id: "exports", label: "Exports", icon: "download" },
  { id: "settings", label: "Réglages", icon: "settings" },
];

const fromHash = (): Page => {
  const h = location.hash.replace(/^#\/?/, "") as Page;
  return PAGES.some((p) => p.id === h) ? h : "dashboard";
};

export default function App() {
  const { demo, status, error, setError, online, pending, uploads, refresh, transactions } = useStore();
  const [page, setPage] = useState<Page>(fromHash);
  const [filters, setFilters] = useState<TxFilters | undefined>();

  useEffect(() => {
    const onHash = () => setPage(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const nav: Nav = useCallback((p, f) => {
    setFilters(f);
    location.hash = `/${p}`;
    setPage(p);
    window.scrollTo({ top: 0 });
  }, []);

  const toReview = transactions.filter((t) => t.status === "to_review").length;
  const unsynced = pending.length + uploads.length;

  return (
    <div className="min-h-dvh md:flex">
      {/* Barre latérale (bureau) */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-s1 p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2 text-lg font-semibold">
          <span className="grid size-8 place-items-center rounded-xl bg-accent text-sm text-white">€</span> Compta
        </div>
        <nav className="flex flex-col gap-1">
          {PAGES.map((p) => (
            <button key={p.id} onClick={() => nav(p.id)} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${page === p.id ? "bg-s2 font-medium text-ink" : "text-ink2 hover:bg-s2/60"}`}>
              <Icon name={p.icon} />
              {p.label}
              {p.id === "operations" && toReview > 0 && <span className="ml-auto chip bg-warn/15 text-warn">{toReview}</span>}
            </button>
          ))}
        </nav>
        <div className="mt-auto px-2 text-xs text-mute">
          {demo ? "Mode démo" : status === "syncing" ? "Synchronisation…" : status === "loading" ? "Chargement…" : unsynced ? `${unsynced} modification(s) en attente` : "Synchronisé"}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* En-tête (mobile) */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-s1/90 px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur md:hidden">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-xs text-white">€</span>
          <span className="font-semibold">Compta</span>
          <span className="ml-auto text-xs text-mute">{demo ? "démo" : unsynced ? `${unsynced} en attente` : ""}</span>
          {!demo && (
            <button className="rounded-full p-1.5 text-ink2" onClick={refresh} aria-label="Recharger">
              <Icon name="refresh" className={`size-5 ${status !== "idle" ? "animate-spin" : ""}`} />
            </button>
          )}
        </header>

        {!online && (
          <div className="flex items-center gap-2 bg-warn/15 px-4 py-2 text-sm text-warn">
            <Icon name="cloudOff" className="size-4" /> Hors-ligne : tes modifications seront synchronisées au retour du réseau.
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 bg-bad/10 px-4 py-2 text-sm text-bad">
            <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} aria-label="Fermer"><Icon name="x" className="size-4" /></button>
          </div>
        )}

        <main className="mx-auto max-w-6xl px-4 pb-28 pt-4 sm:px-6 md:pb-10 md:pt-8">
          {page === "dashboard" && <Dashboard nav={nav} />}
          {page === "operations" && <Transactions initial={filters} />}
          {page === "documents" && <Documents />}
          {page === "exports" && <Exports />}
          {page === "settings" && <Settings />}
        </main>
      </div>

      {/* Barre d'onglets (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-s1/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {PAGES.map((p) => (
          <button key={p.id} onClick={() => nav(p.id)} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${page === p.id ? "text-accent" : "text-ink2"}`}>
            <Icon name={p.icon} className="size-6" />
            {p.label}
            {p.id === "operations" && toReview > 0 && <span className="absolute right-[22%] top-1 size-2 rounded-full bg-warn" />}
          </button>
        ))}
      </nav>
    </div>
  );
}
