import { BlogSlug } from "#domain/Blog";
import { Schema } from "effect";

/** No subblog has the requested `BlogSlug` (404). */
export class BlogNotFound extends Schema.TaggedError<
  BlogNotFound,
  { readonly brand: unique symbol }
>()(
  "BlogNotFound",
  { blog: BlogSlug },
  {
    httpApiStatus: 404,
    description: "No subblog with this slug exists.",
  },
) {}
