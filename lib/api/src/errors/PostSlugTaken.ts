import { PostSlug } from "#domain/Blog";
import { Schema } from "effect";

/** Another post of the same subblog already has this slug (409). */
export class PostSlugTaken extends Schema.TaggedError<
  PostSlugTaken,
  { readonly brand: unique symbol }
>()(
  "PostSlugTaken",
  { slug: PostSlug },
  {
    httpApiStatus: 409,
    description: "Another post of the subblog already has this slug.",
  },
) {}
