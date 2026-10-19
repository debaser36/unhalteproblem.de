import { useAtomValue } from "@effect/atom-react";
import type { ReactNode } from "react";
import { AsyncResult, type Atom } from "effect/reactivity";
import { Alert } from "#ui/Alert.tsx";
import { Loading } from "#ui/Spinner.tsx";
import { describeFailure, errorTag } from "./errors.ts";

export interface AsyncViewProps<A, E> {
  readonly atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>;
  readonly children: (value: A, waiting: boolean) => ReactNode;
  /** Shown before the first value arrives; a spinner by default. */
  readonly loading?: ReactNode;
  /**
   * Shown instead of the generic error for a failure; return `undefined`
   * to fall back to it (e.g. render a 404 page for `PostNotFound`).
   */
  readonly failure?: (tag: string | undefined) => ReactNode | undefined;
}

/**
 * Renders the result of a query atom: a loading state, an error message,
 * or `children` with the value. While a refetch runs the previous value
 * stays on screen (`waiting` is true); a failed one shows the error.
 */
export function AsyncView<A, E>({
  atom,
  children,
  loading,
  failure,
}: AsyncViewProps<A, E>) {
  const result = useAtomValue(atom);
  if (AsyncResult.isInitial(result)) return loading ?? <Loading />;
  if (AsyncResult.isFailure(result)) {
    const custom = failure?.(errorTag(result.cause));
    if (custom !== undefined) return custom;
    return (
      <Alert tone="danger" title="Could not load this.">
        {describeFailure(result.cause)}
      </Alert>
    );
  }
  return children(result.value, result.waiting);
}
