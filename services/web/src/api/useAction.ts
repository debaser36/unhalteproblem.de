import { useAtomSet } from "@effect/atom-react";
import type { Exit } from "effect";
import { type Atom, type AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { useToast } from "#ui/toasts.ts";
import { failureMessage } from "./errors.ts";

export interface ActionOptions {
  /**
   * The toast after it worked. With it, a failure is a toast too; without
   * it, nothing is shown and the caller presents the returned message.
   */
  readonly success?: string;
  /** Messages per error tag, as for `failureMessage`. */
  readonly errors?: Record<string, string>;
}

/**
 * A mutation run from an event handler: `run` sends it and resolves to
 * `undefined` once it worked or to the message why not, and `pending` is
 * true while it is on its way. Options given to `run` override the hook's.
 */
export const useAction = <A, E, W>(
  mutation: Atom.Writable<AsyncResult.AsyncResult<A, E>, W>,
  options: ActionOptions = {},
) => {
  const send: (value: W) => Promise<Exit.Exit<A, E>> = useAtomSet(mutation, {
    mode: "promiseExit",
  });
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const run = async (
    value: W,
    overrides: ActionOptions = {},
  ): Promise<string | undefined> => {
    const { success, errors } = { ...options, ...overrides };
    setPending(true);
    const exit = await send(value);
    setPending(false);
    const error = failureMessage(exit, errors);
    if (success !== undefined) {
      toast(error === undefined ? "success" : "error", error ?? success);
    }
    return error;
  };

  return { run, pending };
};
