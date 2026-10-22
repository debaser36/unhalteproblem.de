import { Schema } from "effect";

/** No food item with the requested id exists (404). */
export class FoodItemNotFound extends Schema.TaggedError<
  FoodItemNotFound,
  { readonly brand: unique symbol }
>()(
  "FoodItemNotFound",
  {
    /** The requested food item id. */
    item: Schema.String,
  },
  {
    httpApiStatus: 404,
    description: "No food item with this id exists.",
  },
) {}
