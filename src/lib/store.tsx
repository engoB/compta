import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { del, get, set } from "idb-keyval";
import {
  defaultRules, emptyLedger, emptyOverrides, Ledger, Overrides, Rules, type Transaction,
} from "../../shared/schema";
import { consolidate } from "../../shared/view";
import { demoLedger } from "./demo";
import {
  bytesToBase64, dispatchWorkflow, getJsonRaw, getJsonWithSha, GitHubError, latestRun, putFile, putJson,
  type RunInfo, type Settings,
} from "./github";
import { compressImage } from "./image";
import type { Period } from "./period";

export type Op =
  | { kind: "edit"; id: string; patch: Partial<Transaction> }
  | { kind: "add"; tx: Transaction }
  | { kind: "delete"; id: string };

export interface PendingUpload {
  path: string;
  name: string;
  size: number;
  base64: string;
}

export interface LastRun {
  at: string;
  model: string;
  processed: number;
  toReview: number;
  errors: number;
  duplicates: number;
  newTx: number;
  matched: number;
  costUsd: number;
}

interface Cache {
  ledger: Ledger;
  overrides: Overrides;
  rules: Rules;
  rulesSha?: string;
  lastRun: LastRun | null;
  loadedAt: string;
}

/** Applique des opérations locales sur le fichier overrides (fonction pure). */
export function applyOps(o: Overrides, ops: Op[]): Overrides {
  const next: Overrides = structuredClone(o);
  for (const op of ops) {
    if (op.kind === "edit") next.edits[op.id] = { ...next.edits[op.id], ...op.patch };
    else if (op.kind === "add") next.added.push(op.tx);
    else {
      const wasAdded = next.added.some((t) => t.id === op.id);
      next.added = next.added.filter((t) => t.id !== op.id);
      delete next.edits[op.id];
      if (!wasAdded && !next.deleted.includes(op.id)) next.deleted.push(op.id);
    }
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

const SETTINGS_KEY = "compta.settings";
const PERIOD_KEY = "compta.period";

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveLocal(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible (navigation privée) */
  }
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useStoreValue() {
  const [settings, setSettingsState] = useState<Settings | null>(() => loadLocal<Settings | null>(SETTINGS_KEY, null));
  const demo = !settings?.token;
  const [ledger, setLedger] = useState<Ledger>(() => (demo ? demoLedger() : emptyLedger()));
  const [baseOverrides, setBaseOverrides] = useState<Overrides>(emptyOverrides);
  const [rules, setRules] = useState<Rules>(defaultRules);
  const [rulesSha, setRulesSha] = useState<string | undefined>();
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [pending, setPending] = useState<Op[]>([]);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "syncing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [run, setRun] = useState<RunInfo | null>(null);
  const [period, setPeriodState] = useState<Period>(() => loadLocal<Period>(PERIOD_KEY, { preset: "last-12" }));

  const pendingRef = useRef(pending);
  const uploadsRef = useRef(uploads);
  const syncing = useRef(false);
  pendingRef.current = pending;
  uploadsRef.current = uploads;

  const overrides = useMemo(() => applyOps(baseOverrides, pending), [baseOverrides, pending]);
  const transactions = useMemo(() => consolidate(ledger, overrides), [ledger, overrides]);

  // --- Cache hors-ligne (IndexedDB) ---
  const persistCache = useCallback(async (c: Cache) => {
    try {
      await set("cache", c);
    } catch {
      /* ignore */
    }
  }, []);

  const updatePending = useCallback((next: Op[]) => {
    pendingRef.current = next;
    setPending(next);
    set("pending", next).catch(() => {});
  }, []);
  const updateUploads = useCallback((next: PendingUpload[]) => {
    uploadsRef.current = next;
    setUploads(next);
    set("uploads", next).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    if (!settings?.token) return;
    setStatus("loading");
    setError(null);
    try {
      const [l, o, r, lr] = await Promise.all([
        getJsonRaw<unknown>(settings, "data/ledger.json"),
        getJsonWithSha<unknown>(settings, "data/overrides.json"),
        getJsonWithSha<unknown>(settings, "data/rules.json"),
        getJsonRaw<LastRun>(settings, "data/last-run.json"),
      ]);
      const cache: Cache = {
        ledger: l ? Ledger.parse(l) : emptyLedger(),
        overrides: o ? Overrides.parse(o.data) : emptyOverrides(),
        rules: r ? Rules.parse(r.data) : defaultRules(),
        rulesSha: r?.sha,
        lastRun: lr,
        loadedAt: new Date().toISOString(),
      };
      setLedger(cache.ledger);
      setBaseOverrides(cache.overrides);
      setRules(cache.rules);
      setRulesSha(cache.rulesSha);
      setLastRun(cache.lastRun);
      setLoadedAt(cache.loadedAt);
      await persistCache(cache);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setStatus("idle");
    }
  }, [settings, persistCache]);

  const sync = useCallback(async () => {
    if (!settings?.token || syncing.current || !navigator.onLine) return;
    if (!pendingRef.current.length && !uploadsRef.current.length) return;
    syncing.current = true;
    setStatus("syncing");
    setError(null);
    try {
      // 1) Justificatifs en attente → inbox/ (chaque envoi déclenche la passe d'analyse).
      while (uploadsRef.current.length) {
        const u = uploadsRef.current[0];
        await putFile(settings, u.path, u.base64, `Justificatif : ${u.name}`);
        updateUploads(uploadsRef.current.slice(1));
      }
      // 2) Corrections → data/overrides.json, avec reprise en cas d'écriture concurrente.
      for (let attempt = 0; pendingRef.current.length && attempt < 4; attempt++) {
        const ops = pendingRef.current.slice();
        const remote = await getJsonWithSha<unknown>(settings, "data/overrides.json");
        const next = applyOps(remote ? Overrides.parse(remote.data) : emptyOverrides(), ops);
        try {
          await putJson(settings, "data/overrides.json", next, `Corrections manuelles (${ops.length})`, remote?.sha);
        } catch (e) {
          if (e instanceof GitHubError && (e.status === 409 || e.status === 422)) continue;
          throw e;
        }
        setBaseOverrides(next);
        updatePending(pendingRef.current.slice(ops.length));
        const cached = await get<Cache>("cache");
        if (cached) await persistCache({ ...cached, overrides: next });
      }
    } catch (e) {
      setError(`Synchronisation : ${errMsg(e)}`);
    } finally {
      syncing.current = false;
      setStatus("idle");
    }
  }, [settings, updatePending, updateUploads, persistCache]);

  // Chargement initial : cache local d'abord (instantané, hors-ligne), puis réseau.
  useEffect(() => {
    if (demo) {
      setLedger(demoLedger());
      setBaseOverrides(emptyOverrides());
      setRules(defaultRules());
      setLastRun({ at: new Date(Date.now() - 3 * 3600e3).toISOString(), model: "claude-opus-5-5", processed: 2, toReview: 1, errors: 0, duplicates: 0, newTx: 41, matched: 3, costUsd: 0.06 });
      setLoadedAt(new Date().toISOString());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [cache, p, u] = await Promise.all([get<Cache>("cache"), get<Op[]>("pending"), get<PendingUpload[]>("uploads")]);
        if (cancelled) return;
        if (cache) {
          setLedger(cache.ledger);
          setBaseOverrides(cache.overrides);
          setRules(cache.rules);
          setRulesSha(cache.rulesSha);
          setLastRun(cache.lastRun);
          setLoadedAt(cache.loadedAt);
        }
        if (p) updatePending(p);
        if (u) updateUploads(u);
      } catch {
        /* IndexedDB indisponible */
      }
      if (!cancelled) {
        await refresh();
        await sync();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, refresh, sync, updatePending, updateUploads]);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      void sync();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [sync]);

  // Synchronisation automatique, regroupée, après chaque modification.
  useEffect(() => {
    if (demo || (!pending.length && !uploads.length)) return;
    const t = setTimeout(() => void sync(), 1200);
    return () => clearTimeout(t);
  }, [pending, uploads, demo, sync]);

  const apply = useCallback(
    (ops: Op[]) => {
      if (!ops.length) return;
      if (demo) setBaseOverrides((o) => applyOps(o, ops));
      else updatePending([...pendingRef.current, ...ops]);
    },
    [demo, updatePending],
  );

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      if (demo) {
        setError("Mode démo : connecte ton dépôt dans Réglages pour envoyer des justificatifs.");
        return;
      }
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
      const added: PendingUpload[] = [];
      for (const f of Array.from(files)) {
        const blob = await compressImage(f);
        const ext = blob === f ? "" : ".jpg";
        const safe = f.name.replace(/\.[^.]+$/, ext ? "" : "$&").replace(/[^\w.\-]+/g, "_") + ext;
        const rand = Math.random().toString(36).slice(2, 6);
        added.push({
          path: `inbox/${stamp}-${rand}-${safe}`,
          name: f.name,
          size: blob.size,
          base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
        });
      }
      updateUploads([...uploadsRef.current, ...added]);
    },
    [demo, updateUploads],
  );

  const saveRules = useCallback(
    async (next: Rules) => {
      setRules(next);
      if (!settings?.token) return;
      const remote = await getJsonWithSha<unknown>(settings, "data/rules.json");
      await putJson(settings, "data/rules.json", next, "Règles de catégorisation", remote?.sha ?? rulesSha);
      const fresh = await getJsonWithSha<unknown>(settings, "data/rules.json");
      setRulesSha(fresh?.sha);
    },
    [settings, rulesSha],
  );

  const runNow = useCallback(async () => {
    if (!settings?.token) {
      setError("Mode démo : connecte ton dépôt dans Réglages.");
      return;
    }
    try {
      await sync();
      await dispatchWorkflow(settings);
      setRun({ status: "queued", conclusion: null, created_at: new Date().toISOString(), html_url: "" });
    } catch (e) {
      setError(errMsg(e));
    }
  }, [settings, sync]);

  // Suivi de la passe en cours, puis rechargement des données à la fin.
  const pollRun = useCallback(async () => {
    if (!settings?.token) return null;
    const r = await latestRun(settings);
    setRun(r);
    return r;
  }, [settings]);

  useEffect(() => {
    if (!run || run.status === "completed") return;
    const t = setInterval(async () => {
      const r = await pollRun();
      if (r?.status === "completed") void refresh();
    }, 8000);
    return () => clearInterval(t);
  }, [run, pollRun, refresh]);

  const setSettings = useCallback((s: Settings | null) => {
    saveLocal(SETTINGS_KEY, s);
    setSettingsState(s);
  }, []);

  const setPeriod = useCallback((p: Period) => {
    saveLocal(PERIOD_KEY, p);
    setPeriodState(p);
  }, []);

  const clearCache = useCallback(async () => {
    await Promise.all([del("cache"), del("pending"), del("uploads")]).catch(() => {});
    updatePending([]);
    updateUploads([]);
    await refresh();
  }, [refresh, updatePending, updateUploads]);

  return {
    settings, setSettings, demo, ledger, overrides, rules, saveRules, lastRun, loadedAt,
    transactions, pending, uploads, status, error, setError, online, run, pollRun,
    period, setPeriod, refresh, sync, apply, addFiles, runNow, clearCache,
  };
}

type Store = ReturnType<typeof useStoreValue>;
const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore hors StoreProvider");
  return v;
}
