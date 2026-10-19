import { BlogSlug } from "#domain/Blog";
import { Schema } from "effect";

/**
 * A subblog with this slug already exists (409). Slugs are unique and
 * immutable.
 */
export class BlogSlugTaken extends Schema.TaggedError<
  BlogSlugTaken,
  { readonly brand: unique symbol }
>()(
  "BlogSlugTaken",
  { blog: BlogSlug },
  {
    httpApiStatus: 409,
    description: "A subblog with this slug already exists.",
  },
) {}
