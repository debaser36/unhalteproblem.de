import { CategorySlug } from "#domain/Category";
import { Schema } from "effect";

/** No category has the requested `CategorySlug` (404). */
export class CategoryNotFound extends Schema.TaggedError<
  CategoryNotFound,
  { readonly brand: unique symbol }
>()(
  "CategoryNotFound",
  { category: CategorySlug },
  {
    httpApiStatus: 404,
    description: "No category with this slug exists.",
  },
) {}
