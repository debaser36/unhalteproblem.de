import { CategorySlug } from "#domain/Category";
import { Schema } from "effect";

/**
 * The slug of the new name already belongs to another category (409);
 * `category` is that slug. Merge the two instead.
 */
export class CategoryNameTaken extends Schema.TaggedError<
  CategoryNameTaken,
  { readonly brand: unique symbol }
>()(
  "CategoryNameTaken",
  { category: CategorySlug },
  {
    httpApiStatus: 409,
    description: "Another category already has the slug of this name.",
  },
) {}
