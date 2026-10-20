import { useAtomSet } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useCallback } from "react";

export interface Toast {
  readonly id: number;
  readonly tone: "success" | "error";
  readonly message: string;
}

/** The notifications on screen, newest last; `Toaster` renders them. */
export const toastsAtom = Atom.make<ReadonlyArray<Toast>>([]).pipe(
  Atom.keepAlive,
);

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
