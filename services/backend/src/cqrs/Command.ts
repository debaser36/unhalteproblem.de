import type { Effect } from "effect";
import * as Query from "./Query.ts";
import type { Transaction } from "./Transaction.ts";

/**
 * The boundary of a command: a change to one or more aggregates that
 * succeeds or fails as a whole. The body runs in a `Transaction` (joining
 * the caller's as a savepoint, if there is one), its recorded domain events
 * are published after the commit, and it fails only with domain errors;
 * infrastructure errors become defects, as in `Query.boundary`.
 *
 * Pass it as the last argument of `Effect.fn`, so the span covers the whole
 * transaction:
 *
 * ```ts
 * const transaction = yield* Transaction;
 * // ...
 * syncFromLogin: Effect.fn("UserCommands.syncFromLogin")(function* (login) {
 *   // ...
 *   yield* DomainEvent.record(new UserRegistered({ ... }));
 * }, Command.boundary(transaction)),
 * ```
 */
export const boundary =
  (transaction: Transaction["Service"]) =>
  <A, E, R>(
    self: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, Exclude<E, Query.InfrastructureError>, R> =>
    Query.boundary(transaction.run(self));
