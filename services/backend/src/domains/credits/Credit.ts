import type { CreditFeature, PaymentId, Role } from "@unhalteproblem.de/api";
import { DateTime } from "effect";

/**
 * Credits: single uses of a feature, bought with one-off purchases (one
 * meal plan per `mealPlan` credit). Using the feature consumes a credit;
 * a use that fails gives it back. Credits never expire. The rules, as pure
 * functions.
 */

/**
 * The role that comes with a feature's credits: held while the user has a
 * credit of the feature that was not revoked, used or not. It lets them
 * use what surrounds the feature (for meal plans: the food data and their
 * own plans); the credits limit how often they use the feature itself.
 */
export const featureRoles = {
  mealPlan: "mealPlanBuyer",
} as const satisfies Record<CreditFeature, Role>;

/** A role that comes with credits. */
export type CreditRole = (typeof featureRoles)[CreditFeature];

/** The roles that come with these features, sorted, without duplicates. */
export const rolesOfFeatures = (
  features: ReadonlyArray<CreditFeature>,
): ReadonlyArray<CreditRole> =>
  [...new Set(features.map((feature) => featureRoles[feature]))].sort();

/**
 * A version of what a product grants per purchase of one feature: from
 * `since` until the next version. A quantity of 0 grants none (the
 * feature was removed).
 */
export interface ProductCreditOffer {
  readonly feature: CreditFeature;
  readonly quantity: number;
  readonly since: DateTime.Utc;
}

/** Credits of one feature, as a product grants them per purchase. */
export interface CreditQuantity {
  readonly feature: CreditFeature;
  readonly quantity: number;
}

/**
 * What a product grants per purchase at `at`, from all its versions: per
 * feature the newest version not after `at`, unless it grants none.
 * Sorted by feature.
 */
export const offerAt = (
  versions: ReadonlyArray<ProductCreditOffer>,
  at: DateTime.Utc,
): ReadonlyArray<CreditQuantity> => {
  const latest = new Map<CreditFeature, ProductCreditOffer>();
  for (const version of versions) {
    if (DateTime.isGreaterThan(version.since, at)) continue;
    const known = latest.get(version.feature);
    if (
      known === undefined ||
      DateTime.isGreaterThan(version.since, known.since)
    ) {
      latest.set(version.feature, version);
    }
  }
  return [...latest.values()]
    .filter(({ quantity }) => quantity > 0)
    .map(({ feature, quantity }) => ({ feature, quantity }))
    .sort((a, b) => a.feature.localeCompare(b.feature));
};

/**
 * The new versions that setting a product's credits to `wanted` needs,
 * given what it grants now: one per feature whose quantity changes, with
 * quantity 0 for a feature that is no longer granted.
 */
export const changedOffers = (
  current: ReadonlyArray<CreditQuantity>,
  wanted: ReadonlyArray<CreditQuantity>,
): ReadonlyArray<CreditQuantity> => {
  const now = new Map(
    current.map(({ feature, quantity }) => [feature, quantity]),
  );
  const next = new Map(
    wanted.map(({ feature, quantity }) => [feature, quantity]),
  );
  return [...new Set([...now.keys(), ...next.keys()])]
    .sort()
    .flatMap((feature) => {
      const quantity = next.get(feature) ?? 0;
      return (now.get(feature) ?? 0) === quantity
        ? []
        : [{ feature, quantity }];
    });
};

/** A one-off purchase of the user, as credits see it. */
export interface CreditPurchase {
  readonly paymentId: PaymentId;
  /** Whether the purchase grants access now (paid, partly refunded, disputed). */
  readonly grantsAccess: boolean;
  /** When its Checkout session was made: what was offered then counts. */
  readonly createdAt: DateTime.Utc;
  /** Every version of what its product grants per purchase. */
  readonly offers: ReadonlyArray<ProductCreditOffer>;
}

/**
 * The credits a purchase gets when it first grants access: what its
 * product offered when the purchase was started (`offerAt`). A change of a
 * product's credits applies to purchases started after it, never to
 * earlier ones, even those paid later; credits a purchase got stay as
 * they are.
 */
export const creditsOfPurchase = (
  purchase: CreditPurchase,
): ReadonlyArray<CreditQuantity> =>
  offerAt(purchase.offers, purchase.createdAt);
