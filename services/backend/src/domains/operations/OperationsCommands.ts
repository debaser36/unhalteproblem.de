import {
  Authorized,
  type OutboxMessageId,
  OutboxMessageNotFound,
} from "@unhalteproblem.de/api";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import * as Command from "#cqrs/Command";
import { Transaction } from "#cqrs/Transaction";
import { AuditCommands } from "#domains/audit/AuditCommands";
import { actorIdOf, UserDirectory } from "#domains/users/UserDirectory";
import { OperationsRepository } from "./OperationsRepository.ts";

const make = Effect.gen(function* () {
  const repository = yield* OperationsRepository;
  const audit = yield* AuditCommands;
  const users = yield* UserDirectory;
  const transaction = yield* Transaction;

  return OperationsCommands.of({
    retryOutboxMessage: Effect.fn("OperationsCommands.retryOutboxMessage")(
      function* (id: OutboxMessageId) {
        const proof = yield* Authorized("admin");
        const actor = yield* actorIdOf(proof).pipe(
          Effect.provideService(UserDirectory, users),
        );
        const topic = yield* repository.retryOutbox(id, yield* DateTime.now);
        if (Option.isNone(topic))
          return yield* new OutboxMessageNotFound({ messageId: id });
        yield* audit.record({
          action: "outbox_retried",
          actor: Option.some(actor),
          target: Option.none(),
          detail: topic.value,
        });
      },
      Command.boundary(transaction),
    ),
  });
});

/**
 * What admins do to the system itself: retry an outbox message (after
 * fixing what made it fail, e.g. the SMTP settings). Audited.
 *
 * @effect-expect-leaking Authorized<"admin">
 * Requiring the proof in every method is the point (see "Authorization" in
 * the README).
 */
export class OperationsCommands extends Context.Service<
  OperationsCommands,
  {
    /** Makes a message due now, with all its attempts back, dead or not. */
    readonly retryOutboxMessage: (
      id: OutboxMessageId,
    ) => Effect.Effect<void, OutboxMessageNotFound, Authorized<"admin">>;
  }
>()("@unhalteproblem.de/backend/domains/operations/OperationsCommands") {
  /** Needs `OperationsRepository`, `AuditCommands`, `UserDirectory` and `Transaction`. */
  static readonly layer = Layer.effect(OperationsCommands, make);
}
