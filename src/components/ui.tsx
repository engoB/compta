import type { ReactNode } from "react";
import type { Transaction } from "../../shared/schema";
import { Icon } from "./Icon";

export function StatusChip({ status }: { status: Transaction["status"] | "processed" | "error" }) {
  const map = {
    verified: ["Vérifiée", "bg-good/12 text-good", "check"],
    processed: ["Traité", "bg-good/12 text-good", "check"],
    auto: ["Auto", "bg-s2 text-ink2", null],
    to_review: ["À vérifier", "bg-warn/15 text-warn", "alert"],
    error: ["Erreur", "bg-bad/12 text-bad", "x"],
  } as const;
  const [label, cls, icon] = map[status];
  return (
    <span className={`chip ${cls}`}>
      {icon && <Icon name={icon} className="size-3" />}
      {label}
    </span>
  );
}

export function Section({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card min-w-0 p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-mute">{children}</p>;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-s1 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-w-lg sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="rounded-full p-1.5 text-ink2 hover:bg-s2" onClick={onClose} aria-label="Fermer">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
