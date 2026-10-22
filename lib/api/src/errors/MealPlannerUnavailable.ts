import { Schema } from "effect";

/**
 * The AI meal planner is not configured or not reachable right now (503).
 * It has no fields on purpose: the reason is nothing to reveal to clients.
 */
export class MealPlannerUnavailable extends Schema.TaggedError<
  MealPlannerUnavailable,
  { readonly brand: unique symbol }
>()(
  "MealPlannerUnavailable",
  {},
  {
    httpApiStatus: 503,
    description:
      "The AI meal planner is not configured or not reachable right now.",
  },
) {}
