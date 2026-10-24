import { Duration, Effect, Layer, Schedule } from "effect";
import * as Outbox from "#cqrs/Outbox";
import { PaymentCommands } from "./PaymentCommands.ts";
import { PaymentQueries } from "./PaymentQueries.ts";
import { PaymentRepository } from "./PaymentRepository.ts";
import {
  CancelCustomerSubscriptions,
  HandleStripeEvent,
} from "./StripeTopics.ts";

/**
 * Stripe retries a webhook for three days; an event id older than this
 * can't come again, so it is forgotten.
 */
const eventRetention = Duration.days(30);

/**
 * The outbox consumers: mirroring webhook events from Stripe, and
 * cancelling the subscriptions of deleted accounts. Both are idempotent
 * (they fetch and set the current state), so a repeat is harmless; while
 * Stripe is unreachable they are retried with backoff.
 */
const Consumers = Layer.unwrap(
  Effect.gen(function* () {
    const commands = yield* PaymentCommands;
    return Layer.mergeAll(
      Outbox.consumer(HandleStripeEvent, commands.handleEvent),
      Outbox.consumer(CancelCustomerSubscriptions, ({ customerId }) =>
        commands.cancelSubscriptionsOf(customerId),
      ),
    );
  }),
);

/**
 * Background work: once at startup, check the roles and credits granted
 * by payments against the current Stripe mode (a new key may be of the other mode);
 * once a day, forget old webhook event ids. A failed run is logged and
 * does not end the job.
 */
const Jobs = Layer.effectDiscard(
  Effect.gen(function* () {
    const commands = yield* PaymentCommands;
    yield* commands.resyncPaidRoles.pipe(
      Effect.tap((checked) =>
        Effect.logInfo("Paid roles checked").pipe(
          Effect.annotateLogs({ checked }),
        ),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Checking paid roles failed", cause),
      ),
      Effect.interruptible,
      Effect.forkScoped,
    );
    yield* commands.purgeEventsOlderThan(eventRetention).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Deleting old Stripe events failed", cause),
      ),
      Effect.repeat(Schedule.spaced("1 day")),
      Effect.interruptible,
      Effect.forkScoped,
    );
  }),
);

/**
 * The payments domain: provides `PaymentCommands` and `PaymentQueries`
 * and runs the outbox consumers and its jobs. The repository stays
 * internal.
 *
 * Needs a migrated `SqlClient`, `Transaction`, `Outbox`, `Stripe`,
 * `UserDirectory`, `ModerationCommands`, `ModerationQueries`,
 * `CreditCommands`, `CreditQueries` and `AuditCommands`.
 */
export const PaymentsLive = Layer.mergeAll(
  Layer.mergeAll(Consumers, Jobs).pipe(
    Layer.provideMerge(PaymentCommands.layer),
  ),
  PaymentQueries.layer,
).pipe(Layer.provide(PaymentRepository.layer));
