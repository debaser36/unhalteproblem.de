import { CategorySlug } from "#domain/Category";
import { Schema } from "effect";

/** A category cannot be merged into itself (409). */
export class CategoryMergeIntoSelf extends Schema.TaggedError<
  CategoryMergeIntoSelf,
  { readonly brand: unique symbol }
>()(
  "CategoryMergeIntoSelf",
  { category: CategorySlug },
  {
    httpApiStatus: 409,
    description: "A category cannot be merged into itself.",
  },
) {}
