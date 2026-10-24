import { useEffect, useState } from "react";
import type { Transaction } from "../../shared/schema";
import { useStore } from "../lib/store";
import { todayIso } from "../lib/format";
import { Modal } from "./ui";
import { Icon } from "./Icon";
import { openDocument } from "../lib/docs";

const PAYMENT = ["carte", "virement", "prélèvement", "chèque", "espèces", "retrait", "autre"];

export function newManualTx(category = "Autre"): Transaction {
  return {
    id: `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    date: todayIso(), label: "", merchant: null, amount: 0, currency: "EUR", category,
    receiptIds: [], mergedFrom: [], status: "verified", manual: true,
  };
}

export function TxEditor({ tx, isNew, onClose }: { tx: Transaction | null; isNew?: boolean; onClose: () => void }) {
  const { apply, rules, settings, ledger, setError } = useStore();
  const [draft, setDraft] = useState<Transaction | null>(tx);
  const [amountText, setAmountText] = useState("");
  useEffect(() => {
    setDraft(tx);
    setAmountText(tx ? String(tx.amount).replace(".", ",") : "");
  }, [tx]);
  if (!draft) return null;

  const upd = (p: Partial<Transaction>) => setDraft({ ...draft, ...p });
  const amount = Number(amountText.replace(/\s/g, "").replace(",", "."));
  const valid = draft.label.trim() && Number.isFinite(amount) && amount !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(draft.date);
  const categories = rules.categories.includes(draft.category) ? rules.categories : [...rules.categories, draft.category];

  function save(status?: Transaction["status"]) {
    if (!draft || !tx || !valid) return;
    const next = { ...draft, amount: Math.round(amount * 100) / 100, ...(status ? { status } : {}) };
    if (isNew) apply([{ kind: "add", tx: next }]);
    else {
      const patch: Partial<Transaction> = {};
      for (const k of ["date", "label", "merchant", "amount", "category", "paymentMethod", "notes", "status"] as const) {
        if (next[k] !== tx[k]) (patch as Record<string, unknown>)[k] = next[k];
      }
      if (Object.keys(patch).length) apply([{ kind: "edit", id: tx.id, patch }]);
    }
    onClose();
  }

  function remove() {
    if (!tx || !confirm("Supprimer cette opération ?")) return;
    apply([{ kind: "delete", id: tx.id }]);
    onClose();
  }

  const docs = [...new Set([draft.docId, ...draft.receiptIds].filter(Boolean) as string[])]
    .map((id) => ledger.documents.find((d) => d.id === id))
    .filter((d) => !!d);

  return (
    <Modal open onClose={onClose} title={isNew ? "Nouvelle opération" : "Modifier l'opération"}>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-1">
          <span className="label">Date</span>
          <input type="date" className="input" value={draft.date} onChange={(e) => upd({ date: e.target.value })} />
        </label>
        <label className="col-span-1">
          <span className="label">Montant (− dépense)</span>
          <input inputMode="decimal" className="input num" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="-12,50" />
        </label>
        <label className="col-span-2">
          <span className="label">Libellé</span>
          <input className="input" value={draft.label} onChange={(e) => upd({ label: e.target.value })} />
        </label>
        <label className="col-span-2 sm:col-span-1">
          <span className="label">Marchand</span>
          <input className="input" value={draft.merchant ?? ""} onChange={(e) => upd({ merchant: e.target.value || null })} />
        </label>
        <label className="col-span-2 sm:col-span-1">
          <span className="label">Catégorie</span>
          <select className="input" value={draft.category} onChange={(e) => upd({ category: e.target.value })}>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="col-span-2 sm:col-span-1">
          <span className="label">Moyen de paiement</span>
          <select className="input" value={draft.paymentMethod ?? ""} onChange={(e) => upd({ paymentMethod: e.target.value || null })}>
            <option value="">—</option>
            {PAYMENT.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label className="col-span-2 sm:col-span-1">
          <span className="label">Compte</span>
          <input className="input" value={draft.account ?? ""} disabled={!isNew} onChange={(e) => upd({ account: e.target.value || null })} />
        </label>
        <label className="col-span-2">
          <span className="label">Notes</span>
          <textarea className="input min-h-16" value={draft.notes ?? ""} onChange={(e) => upd({ notes: e.target.value || null })} />
        </label>
      </div>

      {(draft.vatAmount != null || draft.confidence != null) && (
        <p className="mt-3 text-xs text-ink2">
          {draft.vatAmount != null && <>TVA : {draft.vatAmount} €{draft.vatRate != null && ` (${draft.vatRate} %)`} · </>}
          {draft.confidence != null && <>Confiance IA : {Math.round(draft.confidence * 100)} %</>}
        </p>
      )}

      {docs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {docs.map((d) => (
            <button
              key={d.id}
              className="btn-ghost text-xs"
              onClick={() => settings?.token ? openDocument(settings, d.path).catch((e) => setError(e.message)) : setError("Mode démo : aucun fichier réel.")}
            >
              <Icon name="paperclip" className="size-4" /> {d.kind === "bank_statement" ? "Relevé" : "Justificatif"} · {d.filename}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {!isNew && (
          <button className="btn text-bad hover:bg-bad/10" onClick={remove}>
            <Icon name="trash" className="size-4" /> Supprimer
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost" disabled={!valid} onClick={() => save()}>Enregistrer</button>
          <button className="btn-primary" disabled={!valid} onClick={() => save("verified")}>
            <Icon name="check" className="size-4" /> {isNew ? "Ajouter" : "Valider"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
