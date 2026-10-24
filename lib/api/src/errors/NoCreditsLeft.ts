import { CreditFeature } from "#domain/Payment";
import { Schema } from "effect";

/**
 * The caller has no credit left for the feature (402): a `mealPlanBuyer`
 * without `foodPlanner` and without an available meal-plan credit asked for
 * a meal plan. Buy more credits (see `getCatalog`) to continue.
 */
export class NoCreditsLeft extends Schema.TaggedError<
  NoCreditsLeft,
  { readonly brand: unique symbol }
>()(
  "NoCreditsLeft",
  {
    /** The feature that has no credit left. */
    feature: CreditFeature,
  },
  {
    httpApiStatus: 402,
    description:
      "The caller has no credit left for this feature and does not hold " +
      "the role that allows unlimited use.",
  },
) {}
