import {
  Api,
  PaymentNotFound,
  PaymentProductNotFound,
} from "@unhalteproblem.de/api";
import { Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { PaymentCommands } from "#domains/payments/PaymentCommands";
import { PaymentQueries } from "#domains/payments/PaymentQueries";
import { noStore } from "./CacheControl.ts";

/**
 * Payments in the admin panel. Each endpoint's `RequireAdmin` (or
 * `RequireSuperAdmin` for the roles of a product) provides the proof the
 * domain requires; nothing here may be cached.
 */
export const PaymentAdminHandlers = HttpApiBuilder.group(
  Api,
  "paymentAdmin",
  Effect.fn(function* (handlers) {
    const commands = yield* PaymentCommands;
    const queries = yield* PaymentQueries;

    const product = (productId: string) =>
      queries.product(productId).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(new PaymentProductNotFound({ product: productId })),
            onSome: Effect.succeed,
          }),
        ),
      );

    return handlers
      .handle("listPayments", ({ query }) =>
        queries
          .payments({
            limit: query.limit,
            after: Option.fromUndefinedOr(query.cursor),
            userId: Option.fromUndefinedOr(query.userId),
            status: Option.fromUndefinedOr(query.status),
          })
          .pipe(noStore),
      )
      .handle("listSubscriptions", ({ query }) =>
        queries
          .subscriptions({
            limit: query.limit,
            after: Option.fromUndefinedOr(query.cursor),
            userId: Option.fromUndefinedOr(query.userId),
            status: Option.fromUndefinedOr(query.status),
          })
          .pipe(noStore),
      )
      .handle("refundPayment", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* commands.refund(
            params.paymentId,
            Option.fromUndefinedOr(payload.amount),
          );
          const payment = yield* queries.payment(params.paymentId);
          if (Option.isNone(payment)) {
            return yield* new PaymentNotFound({ payment: params.paymentId });
          }
          return payment.value;
        }).pipe(noStore),
      )
      .handle("listPaymentProducts", () => queries.products.pipe(noStore))
      .handle("syncPaymentProducts", () =>
        commands.syncCatalog.pipe(Effect.andThen(queries.products), noStore),
      )
      .handle("updatePaymentProduct", ({ params, payload }) =>
        commands
          .updateProduct(params.productId, payload)
          .pipe(Effect.andThen(product(params.productId)), noStore),
      )
      .handle("setPaymentProductRoles", ({ params, payload }) =>
        commands
          .setProductRoles(params.productId, payload.roles)
          .pipe(Effect.andThen(product(params.productId)), noStore),
      )
      .handle("setPaymentProductCredits", ({ params, payload }) =>
        commands
          .setProductCredits(params.productId, payload.credits)
          .pipe(Effect.andThen(product(params.productId)), noStore),
      );
  }),
);
