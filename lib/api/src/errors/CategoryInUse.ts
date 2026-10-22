import { Schema } from "effect";

/**
 * The category is still used (409) and cannot be deleted. Merge it into
 * another one first.
 */
export class CategoryInUse extends Schema.TaggedError<
  CategoryInUse,
  { readonly brand: unique symbol }
>()(
  "CategoryInUse",
  {
    /** Blogs having the category as main or extra. */
    blogCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    /** Posts of any status, drafts included, having it as main or extra. */
    postCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  },
  {
    httpApiStatus: 409,
    description: "The category is still used by blogs or posts.",
  },
) {}
