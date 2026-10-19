import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { CheckCircle2, X, XCircle } from "lucide-react";
import { useCallback } from "react";
import { Atom } from "effect/reactivity";
import { cn } from "#lib/cn.ts";

export interface Toast {
  readonly id: number;
  readonly tone: "success" | "error";
  readonly message: string;
}

const toastsAtom = Atom.make<ReadonlyArray<Toast>>([]).pipe(Atom.keepAlive);

let nextId = 1;

/** Shows short notifications ("Saved", "Could not save") at the corner. */
export const useToast = () => {
  const setToasts = useAtomSet(toastsAtom);
  return useCallback(
    (tone: Toast["tone"], message: string) => {
      const id = nextId++;
      setToasts((toasts) => [...toasts, { id, tone, message }]);
      setTimeout(
        () => setToasts((toasts) => toasts.filter((t) => t.id !== id)),
        tone === "error" ? 8000 : 4000,
      );
    },
    [setToasts],
  );
};

export function Toaster() {
  const toasts = useAtomValue(toastsAtom);
  const setToasts = useAtomSet(toastsAtom);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 left-4 z-50 flex flex-col items-end gap-2 sm:left-auto"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          className={cn(
            "animate-fade-up pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-surface px-4 py-3 text-sm shadow-2xl",
            toast.tone === "error" ? "border-danger/40" : "border-accent/40",
          )}
        >
          {toast.tone === "error" ? (
            <XCircle size={16} className="mt-0.5 shrink-0 text-danger" />
          ) : (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent" />
          )}
          <p className="flex-1 text-fg-soft">{toast.message}</p>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-muted hover:text-fg"
            onClick={() =>
              setToasts((all) => all.filter((t) => t.id !== toast.id))
            }
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
