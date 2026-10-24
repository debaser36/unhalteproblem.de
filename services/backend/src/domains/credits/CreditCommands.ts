import { type CreditFeature, NoCreditsLeft } from "@unhalteproblem.de/api";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import * as Command from "#cqrs/Command";
import { Transaction } from "#cqrs/Transaction";
import type { UserId } from "#domains/users/User";
import { UserDirectory } from "#domains/users/UserDirectory";
import { type CreditPurchase, creditsOfPurchase } from "./Credit.ts";
import { CreditRepository } from "./CreditRepository.ts";

const make = Effect.gen(function* () {
  const repository = yield* CreditRepository;
  const users = yield* UserDirectory;
  const transaction = yield* Transaction;

  return CreditCommands.of({
    syncPaidCredits: Effect.fn("CreditCommands.syncPaidCredits")(function* (
      userId: UserId,
      purchases: ReadonlyArray<CreditPurchase>,
    ) {
      const [user] = yield* users.lockForUpdate([userId]);
      // A deleted account keeps nothing, whatever Stripe still says.
      const granting =
        user === undefined || Option.isSome(user.deletedAt)
          ? []
          : purchases.filter((purchase) => purchase.grantsAccess);
      const ids = granting.map((purchase) => purchase.paymentId);
      const now = yield* DateTime.now;
      const known = yield* repository.paymentsWithCredits(ids);
      for (const purchase of granting) {
        // What a purchase got the first time stays; see creditsOfPurchase.
        if (known.has(purchase.paymentId)) continue;
        for (const { feature, quantity } of creditsOfPurchase(purchase)) {
          yield* repository.grant({
            userId,
            paymentId: purchase.paymentId,
            feature,
            quantity,
            grantedAt: now,
          });
        }
      }
      yield* repository.restore(userId, ids);
      yield* repository.revokeAllBut(userId, ids, now);
      return yield* repository.featuresHeld(userId);
    }, Command.boundary(transaction)),

    consume: Effect.fn("CreditCommands.consume")(function* (
      userId: UserId,
      feature: CreditFeature,
      usedFor: string,
    ) {
      const taken = yield* repository.takeAvailable({
        userId,
        feature,
        usedFor,
        consumedAt: yield* DateTime.now,
      });
      if (!taken) return yield* new NoCreditsLeft({ feature });
    }, Command.boundary(transaction)),

    release: Effect.fn("CreditCommands.release")(function* (
      feature: CreditFeature,
      usedFor: string,
    ) {
      return yield* repository.release(feature, usedFor);
    }, Command.boundary(transaction)),

    revokeAllOf: Effect.fn("CreditCommands.revokeAllOf")(function* (
      userId: UserId,
    ) {
      yield* repository.revokeAllBut(userId, [], yield* DateTime.now);
    }, Command.boundary(transaction)),
  });
});

/**
 * The changes of credits: granting and revoking those that one-off
 * purchases entitle a user to (for the payments domain), and using and
 * giving back a credit (for the domains of the features). Every method
 * joins the caller's transaction.
 */
export class CreditCommands extends Context.Service<
  CreditCommands,
  {
    /**
     * Brings the user's credits in line with their one-off purchases of
     * the current mode (all of them): a purchase that grants access gets
     * its credits the first time (`creditsOfPurchase`) and gets back the
     * ones that were revoked; the credits of every other payment are
     * revoked, used or not. Returns the features the user holds credits of
     * afterwards, which decide their credit roles (`featureRoles`).
     */
    readonly syncPaidCredits: (
      userId: UserId,
      purchases: ReadonlyArray<CreditPurchase>,
    ) => Effect.Effect<ReadonlyArray<CreditFeature>>;
    /**
     * Uses the user's oldest available credit of the feature for
     * `usedFor` (the id of what it pays for, e.g. a meal plan). Fails with
     * `NoCreditsLeft` if they have none.
     */
    readonly consume: (
      userId: UserId,
      feature: CreditFeature,
      usedFor: string,
    ) => Effect.Effect<void, NoCreditsLeft>;
    /**
     * Gives back the credit used for `usedFor`, when what it paid for
     * failed or never happened. Returns false if no credit was used for it.
     */
    readonly release: (
      feature: CreditFeature,
      usedFor: string,
    ) => Effect.Effect<boolean>;
    /** Revokes all the user's credits (account deletion). */
    readonly revokeAllOf: (userId: UserId) => Effect.Effect<void>;
  }
>()("@unhalteproblem.de/backend/domains/credits/CreditCommands") {
  /** Needs `CreditRepository`, `UserDirectory` and `Transaction`. */
  static readonly layer = Layer.effect(CreditCommands, make);
}
