import { Schema } from "effect";

/** No food import with the requested id exists (404). */
export class FoodImportNotFound extends Schema.TaggedError<
  FoodImportNotFound,
  { readonly brand: unique symbol }
>()(
  "FoodImportNotFound",
  {
    /** The requested food import id. */
    importId: Schema.String,
  },
  {
    httpApiStatus: 404,
    description: "No food import with this id exists.",
  },
) {}
