import { Api, CurrentUser } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { PaymentCommands } from "#domains/payments/PaymentCommands";
import { PaymentQueries } from "#domains/payments/PaymentQueries";
import { cacheControl, noStore } from "./CacheControl.ts";

/** The public catalog: the same for everyone, so briefly cacheable. */
export const PaymentCatalogHandlers = HttpApiBuilder.group(
  Api,
  "paymentCatalog",
  Effect.fn(function* (handlers) {
    const queries = yield* PaymentQueries;
    return handlers.handle("getCatalog", () =>
      queries.catalog.pipe(cacheControl("public, max-age=60")),
    );
  }),
);

/**
 * Paying, for the logged-in user: Checkout, the customer portal and their
 * own history. Always the session's own user (`CurrentUser`).
 */
export const PaymentsHandlers = HttpApiBuilder.group(
  Api,
  "payments",
  Effect.fn(function* (handlers) {
    const commands = yield* PaymentCommands;
    const queries = yield* PaymentQueries;
    return handlers
      .handle("startCheckout", ({ payload }) =>
        Effect.gen(function* () {
          const { user } = yield* Effect.service(CurrentUser);
          return yield* commands.startCheckout(user.id, payload);
        }).pipe(noStore),
      )
      .handle("openBillingPortal", () =>
        Effect.gen(function* () {
          const { user } = yield* Effect.service(CurrentUser);
          return yield* commands.openBillingPortal(user.id);
        }).pipe(noStore),
      )
      .handle("myPayments", () =>
        Effect.gen(function* () {
          const { user } = yield* Effect.service(CurrentUser);
          return yield* queries.mine(user.id);
        }).pipe(noStore),
      );
  }),
);

/**
 * Stripe's webhook. Public: the signature over the raw body is the
 * authentication, checked before anything is stored. Answers 200 as soon
 * as the event is queued; the work happens in the outbox.
 */
export const PaymentWebhooksHandlers = HttpApiBuilder.group(
  Api,
  "paymentWebhooks",
  Effect.fn(function* (handlers) {
    const commands = yield* PaymentCommands;
    return handlers.handle("stripeWebhook", ({ payload, headers }) =>
      commands
        .receiveWebhook(payload, headers["stripe-signature"])
        .pipe(noStore),
    );
  }),
);
