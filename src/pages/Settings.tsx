import { useState } from "react";
import type { Rule } from "../../shared/schema";
import { useStore } from "../lib/store";
import { testConnection, type Settings as S } from "../lib/github";
import { relativeTime } from "../lib/format";
import { Section } from "../components/ui";
import { Icon } from "../components/Icon";

export function Settings() {
  const { settings, setSettings, rules, saveRules, clearCache, loadedAt, demo, refresh } = useStore();
  const [form, setForm] = useState<S>(settings ?? { owner: "engoB", repo: "compta", branch: "main", token: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newCat, setNewCat] = useState("");
  const [rule, setRule] = useState<Rule>({ pattern: "", category: rules.categories[0] ?? "Autre" });
  const [saving, setSaving] = useState(false);

  async function connect() {
    setMsg(null);
    try {
      const text = await testConnection(form);
      setSettings(form);
      setMsg({ ok: true, text });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function persist(next: typeof rules) {
    setSaving(true);
    try {
      await saveRules(next);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const addRule = () => {
    try {
      new RegExp(rule.pattern, "i");
    } catch {
      alert("Expression invalide");
      return;
    }
    if (rule.pattern.trim()) void persist({ ...rules, rules: [...rules.rules, { ...rule, pattern: rule.pattern.trim() }] });
    setRule({ ...rule, pattern: "" });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Réglages</h1>

      <Section title="Connexion au dépôt GitHub (privé)">
        {demo && <p className="mb-3 rounded-xl bg-accent/10 p-3 text-sm text-ink">Tu es en <b>mode démo</b> (données fictives). Renseigne ton jeton pour utiliser tes vraies données.</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <label><span className="label">Propriétaire</span><input className="input" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value.trim() })} /></label>
          <label><span className="label">Dépôt</span><input className="input" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value.trim() })} /></label>
          <label><span className="label">Branche</span><input className="input" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value.trim() })} /></label>
          <label className="sm:col-span-3">
            <span className="label">Jeton d'accès (fine-grained, limité à ce dépôt)</span>
            <input className="input font-mono" type="password" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value.trim() })} placeholder="github_pat_…" />
          </label>
        </div>
        <p className="mt-2 text-xs text-ink2">
          Crée-le sur <a className="text-accent hover:underline" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">github.com → Settings → Developer settings → Fine-grained tokens</a> :
          accès au seul dépôt <code>{form.owner}/{form.repo}</code>, permissions <b>Contents : Read and write</b> et <b>Actions : Read and write</b>.
          Il reste stocké uniquement sur cet appareil.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={connect} disabled={!form.token}>Tester et enregistrer</button>
          {settings && <button className="btn-ghost" onClick={() => { setSettings(null); setForm({ ...form, token: "" }); }}>Se déconnecter</button>}
          {msg && <span className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span>}
        </div>
      </Section>

      <Section title="Catégories" action={saving ? <span className="text-xs text-mute">Enregistrement…</span> : undefined}>
        <div className="flex flex-wrap gap-2">
          {rules.categories.map((c) => (
            <span key={c} className="chip bg-s2 py-1 text-ink">
              {c}
              <button aria-label={`Retirer ${c}`} className="text-mute hover:text-bad" onClick={() => confirm(`Retirer « ${c} » ?`) && persist({ ...rules, categories: rules.categories.filter((x) => x !== c) })}>
                <Icon name="x" className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input className="input" placeholder="Nouvelle catégorie" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          <button className="btn-ghost" disabled={!newCat.trim() || rules.categories.includes(newCat.trim())} onClick={() => { void persist({ ...rules, categories: [...rules.categories, newCat.trim()] }); setNewCat(""); }}>Ajouter</button>
        </div>
      </Section>

      <Section title="Règles de catégorisation">
        <p className="mb-3 text-xs text-ink2">
          Prioritaires sur l'IA, appliquées à chaque passe. Le motif est une expression régulière testée sur le libellé et le marchand
          (ex. <code>sncf|ouigo</code> → Transport). Tes corrections manuelles sont aussi apprises automatiquement.
        </p>
        <ul className="mb-3 divide-y divide-line">
          {rules.rules.map((r, i) => (
            <li key={i} className="flex items-center gap-2 py-2 text-sm">
              <code className="truncate rounded bg-s2 px-1.5 py-0.5">{r.pattern}</code>
              <span className="text-mute">→</span>
              <span className="flex-1 truncate">{r.category}</span>
              <button className="rounded-lg p-1 text-mute hover:text-bad" aria-label="Supprimer la règle" onClick={() => persist({ ...rules, rules: rules.rules.filter((_, j) => j !== i) })}>
                <Icon name="trash" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-40 flex-1 font-mono" placeholder="motif, ex. carrefour|lidl" value={rule.pattern} onChange={(e) => setRule({ ...rule, pattern: e.target.value })} />
          <select className="input w-auto" value={rule.category} onChange={(e) => setRule({ ...rule, category: e.target.value })}>
            {rules.categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button className="btn-ghost" onClick={addRule} disabled={!rule.pattern.trim()}><Icon name="plus" className="size-4" /> Règle</button>
        </div>
      </Section>

      <Section title="Données locales">
        <p className="text-sm text-ink2">
          Les données sont mises en cache sur l'appareil pour fonctionner hors-ligne{loadedAt && <> (dernier chargement {relativeTime(loadedAt)})</>}.
        </p>
        <div className="mt-3 flex gap-2">
          <button className="btn-ghost" onClick={refresh} disabled={demo}><Icon name="refresh" className="size-4" /> Recharger</button>
          <button className="btn-ghost" onClick={() => confirm("Vider le cache local ? Les modifications non synchronisées seront perdues.") && clearCache()} disabled={demo}>Vider le cache</button>
        </div>
      </Section>
    </div>
  );
}
