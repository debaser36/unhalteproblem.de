import { type PaymentId, type PaymentStatus } from "@unhalteproblem.de/api";
import { DateTime, Effect } from "effect";
import { SqlClient } from "effect/sql";
import { CreditCommands } from "#domains/credits/CreditCommands";
import type { UserId } from "#domains/users/User";

/**
 * Credit fixtures: a one-off purchase row and the credits it granted,
 * without going through Stripe. Test support only, like everything in
 * `#testing/*`.
 */

/** Inserts a one-off purchase of `userId` (no product) and answers its id. */
export const insertPurchase = (
  userId: string,
  status: PaymentStatus = "paid",
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const id = crypto.randomUUID() as PaymentId;
    yield* sql`
      INSERT INTO payments (
        id, user_id, kind, checkout_session_id, amount, currency, status,
        livemode, created_at, updated_at
      ) VALUES (
        ${id}, ${userId}, 'purchase', ${`cs_${id}`}, 1000, 'eur', ${status},
        false, now(), now()
      )
    `.pipe(Effect.orDie);
    return id;
  });

/** Sets the status of a purchase made with `insertPurchase`. */
export const setPurchaseStatus = (id: PaymentId, status: PaymentStatus) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE payments SET status = ${status} WHERE id = ${id}`.pipe(
      Effect.orDie,
    );
  });

/** The purchase `insertPurchase` made, as credits see it. */
export const purchaseOffering = (
  paymentId: PaymentId,
  quantity: number,
  grantsAccess = true,
) => ({
  paymentId,
  grantsAccess,
  createdAt: DateTime.makeUnsafe(1_000),
  offers: [
    {
      feature: "mealPlan" as const,
      quantity,
      since: DateTime.makeUnsafe(0),
    },
  ],
});

/**
 * Gives the user a paid purchase with `quantity` meal-plan credits, as
 * `PaymentCommands` would; answers the purchase's id. Grants no role. Like
 * the real sync it lists all the user's paid purchases, so the credits of
 * earlier ones (which it leaves as they are) stay.
 */
export const grantMealPlanCredits = (userId: UserId, quantity: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const credits = yield* CreditCommands;
    const paymentId = yield* insertPurchase(userId);
    const paid = yield* sql<{ readonly id: PaymentId }>`
      SELECT id FROM payments
      WHERE user_id = ${userId} AND kind = 'purchase' AND status = 'paid'
    `.pipe(Effect.orDie);
    yield* credits.syncPaidCredits(
      userId,
      paid.map(({ id }) =>
        purchaseOffering(id, id === paymentId ? quantity : 1),
      ),
    );
    return paymentId;
  });

/**
 * Like `grantMealPlanCredits`, in SQL only (for tests that don't have the
 * credits domain at hand, such as those of the HTTP app).
 */
export const insertMealPlanCredits = (userId: string, quantity: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const paymentId = yield* insertPurchase(userId);
    for (let seq = 1; seq <= quantity; seq++) {
      yield* sql`
        INSERT INTO feature_credits (
          id, user_id, payment_id, feature, seq, granted_at
        ) VALUES (
          ${crypto.randomUUID()}, ${userId}, ${paymentId}, 'mealPlan', ${seq},
          now()
        )
      `.pipe(Effect.orDie);
    }
    return paymentId;
  });

/** The user's meal-plan credits that are not revoked, as the API counts them. */
export const mealPlanBalance = (userId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{
      readonly available: number;
      readonly used: number;
    }>`
      SELECT count(*) FILTER (WHERE consumed_at IS NULL)::int AS available,
        count(*) FILTER (WHERE consumed_at IS NOT NULL)::int AS used
      FROM feature_credits
      WHERE user_id = ${userId} AND feature = 'mealPlan' AND revoked_at IS NULL
    `.pipe(Effect.orDie);
    return { available: row?.available ?? 0, used: row?.used ?? 0 };
  });
