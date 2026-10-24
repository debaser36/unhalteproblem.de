import { assert, describe, layer } from "@effect/vitest";
import { NoCreditsLeft, type PaymentId } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { UserCommands } from "#domains/users/UserCommands";
import type { UserId } from "#domains/users/User";
import {
  grantMealPlanCredits,
  insertPurchase,
  purchaseOffering,
} from "#testing/Credits";
import { makeFakeStripe } from "#testing/Stripe";
import { member, usersTestWith } from "#testing/Users";
import { CreditCommands } from "./CreditCommands.ts";
import { CreditQueries } from "./CreditQueries.ts";

/** An id of something a credit pays for (a meal plan). */
const usage = () => crypto.randomUUID();

const balances = (userId: UserId) =>
  Effect.flatMap(CreditQueries, (queries) => queries.balancesOf(userId));

const available = (userId: UserId) =>
  Effect.map(
    balances(userId),
    (rows) => rows.find((row) => row.feature === "mealPlan")?.available ?? 0,
  );

/** The credits stored for a payment, as the tests need them. */
const rowsOf = (paymentId: PaymentId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql<{
      readonly seq: number;
      readonly consumed: boolean;
      readonly revoked: boolean;
      readonly usedFor: string | null;
    }>`
      SELECT seq, consumed_at IS NOT NULL AS consumed,
        revoked_at IS NOT NULL AS revoked, used_for
      FROM feature_credits WHERE payment_id = ${paymentId} ORDER BY seq
    `;
  });

describe("CreditCommands", () => {
  layer(usersTestWith(makeFakeStripe().layer), { timeout: "30 seconds" })(
    (it) => {
      describe("syncPaidCredits", () => {
        it.effect("grants a granting purchase its credits", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const paymentId = yield* insertPurchase(ada.user.id);
            const held = yield* credits.syncPaidCredits(ada.user.id, [
              purchaseOffering(paymentId, 3),
            ]);
            assert.deepStrictEqual(held, ["mealPlan"]);
            assert.deepStrictEqual(yield* balances(ada.user.id), [
              { feature: "mealPlan", available: 3, used: 0 },
            ]);
            assert.deepStrictEqual(
              (yield* rowsOf(paymentId)).map((row) => row.seq),
              [1, 2, 3],
            );
          }),
        );

        it.effect("grants nothing twice, however often it syncs", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const paymentId = yield* insertPurchase(ada.user.id);
            const purchase = purchaseOffering(paymentId, 3);
            yield* credits.syncPaidCredits(ada.user.id, [purchase]);
            yield* credits.syncPaidCredits(ada.user.id, [purchase]);
            yield* credits.syncPaidCredits(ada.user.id, [purchase]);
            assert.lengthOf(yield* rowsOf(paymentId), 3);
            assert.strictEqual(yield* available(ada.user.id), 3);
          }),
        );

        it.effect("keeps what a purchase got when its product changes", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const paymentId = yield* insertPurchase(ada.user.id);
            yield* credits.syncPaidCredits(ada.user.id, [
              purchaseOffering(paymentId, 3),
            ]);
            yield* credits.syncPaidCredits(ada.user.id, [
              purchaseOffering(paymentId, 5),
            ]);
            assert.strictEqual(yield* available(ada.user.id), 3);
          }),
        );

        it.effect("grants nothing for a purchase that grants no access", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const paymentId = yield* insertPurchase(ada.user.id, "pending");
            const held = yield* credits.syncPaidCredits(ada.user.id, [
              purchaseOffering(paymentId, 3, false),
            ]);
            assert.deepStrictEqual(held, []);
            assert.deepStrictEqual(yield* balances(ada.user.id), []);
            assert.lengthOf(yield* rowsOf(paymentId), 0);
          }),
        );

        it.effect("grants nothing for a purchase without offers", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const paymentId = yield* insertPurchase(ada.user.id);
            const held = yield* credits.syncPaidCredits(ada.user.id, [
              { ...purchaseOffering(paymentId, 3), offers: [] },
            ]);
            assert.deepStrictEqual(held, []);
          }),
        );

        it.effect("adds up the credits of several purchases", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const first = yield* insertPurchase(ada.user.id);
            const second = yield* insertPurchase(ada.user.id);
            yield* credits.syncPaidCredits(ada.user.id, [
              purchaseOffering(first, 2),
              purchaseOffering(second, 3),
            ]);
            assert.strictEqual(yield* available(ada.user.id), 5);
          }),
        );

        it.effect("revokes the credits of a purchase that stops granting", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const paymentId = yield* insertPurchase(ada.user.id);
            yield* credits.syncPaidCredits(ada.user.id, [
              purchaseOffering(paymentId, 3),
            ]);
            const held = yield* credits.syncPaidCredits(ada.user.id, [
              purchaseOffering(paymentId, 3, false),
            ]);
            assert.deepStrictEqual(held, []);
            assert.deepStrictEqual(yield* balances(ada.user.id), []);
            assert.isTrue((yield* rowsOf(paymentId)).every((r) => r.revoked));
          }),
        );

        it.effect("revokes the credits of a purchase it no longer lists", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const paymentId = yield* insertPurchase(ada.user.id);
            yield* credits.syncPaidCredits(ada.user.id, [
              purchaseOffering(paymentId, 3),
            ]);
            const held = yield* credits.syncPaidCredits(ada.user.id, []);
            assert.deepStrictEqual(held, []);
            assert.strictEqual(yield* available(ada.user.id), 0);
          }),
        );

        it.effect(
          "restores revoked credits when the purchase grants again",
          () =>
            Effect.gen(function* () {
              const credits = yield* CreditCommands;
              const ada = yield* member();
              const paymentId = yield* insertPurchase(ada.user.id);
              yield* credits.syncPaidCredits(ada.user.id, [
                purchaseOffering(paymentId, 3),
              ]);
              yield* credits.syncPaidCredits(ada.user.id, [
                purchaseOffering(paymentId, 3, false),
              ]);
              const held = yield* credits.syncPaidCredits(ada.user.id, [
                purchaseOffering(paymentId, 3),
              ]);
              assert.deepStrictEqual(held, ["mealPlan"]);
              assert.strictEqual(yield* available(ada.user.id), 3);
              // Restored, not granted again.
              assert.lengthOf(yield* rowsOf(paymentId), 3);
            }),
        );

        it.effect("leaves the credits of other users alone", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const bob = yield* member();
            yield* grantMealPlanCredits(bob.user.id, 2);
            yield* credits.syncPaidCredits(ada.user.id, []);
            assert.strictEqual(yield* available(bob.user.id), 2);
          }),
        );

        it.effect(
          "grants a deleted account nothing, whatever Stripe says",
          () =>
            Effect.gen(function* () {
              const credits = yield* CreditCommands;
              const users = yield* UserCommands;
              const ada = yield* member();
              const paymentId = yield* insertPurchase(ada.user.id);
              yield* users.deleteAccount(ada.subject);
              const held = yield* credits.syncPaidCredits(ada.user.id, [
                purchaseOffering(paymentId, 3),
              ]);
              assert.deepStrictEqual(held, []);
              assert.lengthOf(yield* rowsOf(paymentId), 0);
            }),
        );

        it.effect("grants an unknown user nothing", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const paymentId = yield* insertPurchase(ada.user.id);
            const held = yield* credits.syncPaidCredits(
              crypto.randomUUID() as UserId,
              [purchaseOffering(paymentId, 3)],
            );
            assert.deepStrictEqual(held, []);
          }),
        );
      });

      describe("consume", () => {
        it.effect("uses one credit", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const paymentId = yield* grantMealPlanCredits(ada.user.id, 2);
            const planId = usage();
            yield* credits.consume(ada.user.id, "mealPlan", planId);
            assert.deepStrictEqual(yield* balances(ada.user.id), [
              { feature: "mealPlan", available: 1, used: 1 },
            ]);
            const used = (yield* rowsOf(paymentId)).filter((r) => r.consumed);
            assert.deepStrictEqual(
              used.map((row) => row.usedFor),
              [planId],
            );
          }),
        );

        it.effect("fails with NoCreditsLeft without credits", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const failure = yield* credits
              .consume(ada.user.id, "mealPlan", usage())
              .pipe(Effect.flip);
            assert.deepStrictEqual(
              failure,
              new NoCreditsLeft({ feature: "mealPlan" }),
            );
          }),
        );

        it.effect("fails once every credit is used", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            yield* grantMealPlanCredits(ada.user.id, 2);
            yield* credits.consume(ada.user.id, "mealPlan", usage());
            yield* credits.consume(ada.user.id, "mealPlan", usage());
            const failure = yield* credits
              .consume(ada.user.id, "mealPlan", usage())
              .pipe(Effect.flip);
            assert.instanceOf(failure, NoCreditsLeft);
            assert.deepStrictEqual(yield* balances(ada.user.id), [
              { feature: "mealPlan", available: 0, used: 2 },
            ]);
          }),
        );

        it.effect("never uses another user's credit", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const bob = yield* member();
            yield* grantMealPlanCredits(bob.user.id, 2);
            const failure = yield* credits
              .consume(ada.user.id, "mealPlan", usage())
              .pipe(Effect.flip);
            assert.instanceOf(failure, NoCreditsLeft);
            assert.strictEqual(yield* available(bob.user.id), 2);
          }),
        );

        it.effect("uses the credit that was granted first", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const older = yield* grantMealPlanCredits(ada.user.id, 1);
            yield* TestClock.adjust("1 hour");
            const newer = yield* grantMealPlanCredits(ada.user.id, 1);
            yield* credits.consume(ada.user.id, "mealPlan", usage());
            assert.isTrue((yield* rowsOf(older))[0]?.consumed);
            assert.isFalse((yield* rowsOf(newer))[0]?.consumed);
          }),
        );

        it.effect("does not use a revoked credit", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            yield* grantMealPlanCredits(ada.user.id, 1);
            yield* credits.revokeAllOf(ada.user.id);
            const failure = yield* credits
              .consume(ada.user.id, "mealPlan", usage())
              .pipe(Effect.flip);
            assert.instanceOf(failure, NoCreditsLeft);
          }),
        );

        it.effect("cannot use one credit twice at once", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            yield* grantMealPlanCredits(ada.user.id, 1);
            const exits = yield* Effect.all(
              Array.from({ length: 4 }, () =>
                credits
                  .consume(ada.user.id, "mealPlan", usage())
                  .pipe(Effect.exit),
              ),
              { concurrency: "unbounded" },
            );
            const used = exits.filter((exit) => exit._tag === "Success");
            assert.lengthOf(used, 1);
            assert.deepStrictEqual(yield* balances(ada.user.id), [
              { feature: "mealPlan", available: 0, used: 1 },
            ]);
          }),
        );
      });

      describe("release", () => {
        it.effect("gives back the credit used for something", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const paymentId = yield* grantMealPlanCredits(ada.user.id, 1);
            const planId = usage();
            yield* credits.consume(ada.user.id, "mealPlan", planId);
            assert.isTrue(yield* credits.release("mealPlan", planId));
            assert.deepStrictEqual(yield* balances(ada.user.id), [
              { feature: "mealPlan", available: 1, used: 0 },
            ]);
            assert.deepStrictEqual(yield* rowsOf(paymentId), [
              { seq: 1, consumed: false, revoked: false, usedFor: null },
            ]);
          }),
        );

        it.effect("answers false for something that used no credit", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            assert.isFalse(yield* credits.release("mealPlan", usage()));
          }),
        );

        it.effect("gives a credit back once", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            yield* grantMealPlanCredits(ada.user.id, 1);
            const planId = usage();
            yield* credits.consume(ada.user.id, "mealPlan", planId);
            assert.isTrue(yield* credits.release("mealPlan", planId));
            assert.isFalse(yield* credits.release("mealPlan", planId));
            assert.strictEqual(yield* available(ada.user.id), 1);
          }),
        );

        it.effect("lets the credit be used again", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            yield* grantMealPlanCredits(ada.user.id, 1);
            const planId = usage();
            yield* credits.consume(ada.user.id, "mealPlan", planId);
            yield* credits.release("mealPlan", planId);
            yield* credits.consume(ada.user.id, "mealPlan", usage());
            assert.strictEqual(yield* available(ada.user.id), 0);
          }),
        );
      });

      describe("used credits", () => {
        it.effect("stay used when their purchase is revoked and restored", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const paymentId = yield* insertPurchase(ada.user.id);
            const granting = purchaseOffering(paymentId, 2);
            yield* credits.syncPaidCredits(ada.user.id, [granting]);
            const planId = usage();
            yield* credits.consume(ada.user.id, "mealPlan", planId);

            yield* credits.syncPaidCredits(ada.user.id, [
              purchaseOffering(paymentId, 2, false),
            ]);
            // Revoked: used or not, none of them counts.
            assert.deepStrictEqual(yield* balances(ada.user.id), []);
            const revoked = yield* rowsOf(paymentId);
            assert.isTrue(revoked.every((row) => row.revoked));
            assert.deepStrictEqual(
              revoked.filter((row) => row.consumed).map((r) => r.usedFor),
              [planId],
            );

            yield* credits.syncPaidCredits(ada.user.id, [granting]);
            assert.deepStrictEqual(yield* balances(ada.user.id), [
              { feature: "mealPlan", available: 1, used: 1 },
            ]);
          }),
        );
      });

      describe("revokeAllOf", () => {
        it.effect("revokes every credit of the user", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const ada = yield* member();
            const bob = yield* member();
            yield* grantMealPlanCredits(ada.user.id, 2);
            yield* grantMealPlanCredits(ada.user.id, 1);
            yield* grantMealPlanCredits(bob.user.id, 1);
            yield* credits.revokeAllOf(ada.user.id);
            assert.deepStrictEqual(yield* balances(ada.user.id), []);
            assert.strictEqual(yield* available(bob.user.id), 1);
          }),
        );
      });

      describe("CreditQueries", () => {
        it.effect("lists the holders of credits that were not revoked", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const queries = yield* CreditQueries;
            const holder = yield* member();
            const former = yield* member();
            const nobody = yield* member();
            yield* grantMealPlanCredits(holder.user.id, 1);
            yield* grantMealPlanCredits(former.user.id, 1);
            yield* credits.revokeAllOf(former.user.id);
            const holders = yield* queries.holders;
            assert.include(holders, holder.user.id);
            assert.notInclude(holders, former.user.id);
            assert.notInclude(holders, nobody.user.id);
          }),
        );

        it.effect("counts a holder with only used credits as holder", () =>
          Effect.gen(function* () {
            const credits = yield* CreditCommands;
            const queries = yield* CreditQueries;
            const ada = yield* member();
            yield* grantMealPlanCredits(ada.user.id, 1);
            yield* credits.consume(ada.user.id, "mealPlan", usage());
            assert.include(yield* queries.holders, ada.user.id);
          }),
        );

        it.effect("answers no balances for a user without credits", () =>
          Effect.gen(function* () {
            const ada = yield* member();
            assert.deepStrictEqual(yield* balances(ada.user.id), []);
          }),
        );
      });
    },
  );
});
