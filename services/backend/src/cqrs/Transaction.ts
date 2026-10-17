import { Context, Effect, Exit, Layer, Option } from "effect";
import { SqlClient, type SqlError } from "effect/sql";
import {
  CurrentUnitOfWork,
  DomainEvents,
  type UnitOfWork,
} from "./DomainEvent.ts";

/**
 * A database transaction that also collects the domain events recorded in
 * it (`DomainEvent.record`) and publishes them only after the commit.
 *
 * Nested `run`s join the enclosing transaction as a savepoint: if the inner
 * part fails, its changes and its events are discarded, and the outer part
 * may still commit.
 *
 * Rules for the effect it runs (a command body):
 *
 * - Open transactions only through this service. A `run` inside a bare
 *   `sql.withTransaction`, and recording inside one, die: the events could
 *   otherwise be published before the real commit or survive a rollback.
 * - Never catch a `SqlError` and carry on. Postgres aborts the transaction
 *   on any error, and its COMMIT then silently rolls back, while the
 *   command would report success and publish its events. To try something
 *   that may fail, wrap it in a nested `run` (a savepoint), or use a
 *   statement that reports the outcome instead of failing, such as
 *   `INSERT … ON CONFLICT DO NOTHING`.
 * - Don't run statements concurrently. All of them share one connection,
 *   so one fiber's statements can end up in another one's savepoint.
 */
export class Transaction extends Context.Service<
  Transaction,
  {
    readonly run: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | SqlError.SqlError, R>;
  }
>()("@unhalteproblem.de/backend/cqrs/Transaction") {
  /** Needs a migrated `SqlClient` and `DomainEvents`. */
  static readonly layer = Layer.effect(
    Transaction,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const domainEvents = yield* DomainEvents;
      const currentDepth = Effect.serviceOption(sql.transactionService).pipe(
        Effect.map(Option.map(([, depth]) => depth)),
      );

      return Transaction.of({
        // Uninterruptible up to the publication, so an interruption that
        // arrives during COMMIT can't separate a commit from its events; it
        // takes effect right after. The effect itself stays interruptible.
        run: (effect) =>
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const enclosing = yield* CurrentUnitOfWork;
              const depth = yield* currentDepth;
              const expected = enclosing?.depth;
              if (Option.getOrUndefined(depth) !== expected) {
                return yield* Effect.die(
                  new Error(
                    "Transaction.run inside a sql.withTransaction that " +
                      "Transaction didn't open",
                  ),
                );
              }
              const unit: UnitOfWork = {
                events: [],
                depth: expected === undefined ? 0 : expected + 1,
                currentDepth,
                open: true,
              };
              const exit = yield* sql
                .withTransaction(
                  restore(
                    Effect.provideService(effect, CurrentUnitOfWork, unit),
                  ),
                )
                .pipe(Effect.exit);
              unit.open = false;
              // A successful exit means committed (or, nested, the savepoint
              // released).
              if (Exit.isSuccess(exit)) {
                if (enclosing === undefined) {
                  yield* domainEvents.publish(unit.events);
                } else {
                  enclosing.events.push(...unit.events);
                }
              }
              return yield* exit;
            }),
          ),
      });
    }),
  );
}
