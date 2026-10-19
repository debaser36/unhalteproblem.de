import { Context, DateTime, type Duration, Effect, Layer } from "effect";
import * as Command from "#cqrs/Command";
import { Transaction } from "#cqrs/Transaction";
import type { AuditEntry } from "./Audit.ts";
import { AuditRepository } from "./AuditRepository.ts";

const make = Effect.gen(function* () {
  const repository = yield* AuditRepository;
  const transaction = yield* Transaction;

  return AuditCommands.of({
    record: Effect.fn("AuditCommands.record")(function* (entry: AuditEntry) {
      const at = yield* DateTime.now;
      yield* repository.insert(entry, at);
    }, Command.boundary(transaction)),

    purgeOlderThan: Effect.fn("AuditCommands.purgeOlderThan")(function* (
      retention: Duration.Input,
    ) {
      const now = yield* DateTime.now;
      return yield* repository.deleteBefore(
        DateTime.subtractDuration(now, retention),
      );
    }, Command.boundary(transaction)),
  });
});

/** The commands of the audit domain. */
export class AuditCommands extends Context.Service<
  AuditCommands,
  {
    /**
     * Appends an entry. Called inside the command it describes, it joins that
     * transaction (a savepoint): the entry exists exactly when the change
     * does. Called alone, it is its own transaction.
     */
    readonly record: (entry: AuditEntry) => Effect.Effect<void>;
    /** Deletes entries older than `retention`; returns how many. */
    readonly purgeOlderThan: (
      retention: Duration.Input,
    ) => Effect.Effect<number>;
  }
>()("@unhalteproblem.de/backend/domains/audit/AuditCommands") {
  /** Needs `AuditRepository` and `Transaction`. */
  static readonly layer = Layer.effect(AuditCommands, make);
}
