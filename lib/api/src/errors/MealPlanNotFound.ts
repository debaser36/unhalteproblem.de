import { Schema } from "effect";

/**
 * No meal plan with the requested id exists for the caller (404). The plans
 * of other users count as missing, so ids reveal nothing about them.
 */
export class MealPlanNotFound extends Schema.TaggedError<
  MealPlanNotFound,
  { readonly brand: unique symbol }
>()(
  "MealPlanNotFound",
  {
    /** The requested meal plan id. */
    plan: Schema.String,
  },
  {
    httpApiStatus: 404,
    description: "No meal plan of the caller with this id exists.",
  },
) {}
