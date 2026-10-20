import { ProjectSlug } from "#domain/Project";
import { Schema } from "effect";

/** Another project already has this slug (409). */
export class ProjectSlugTaken extends Schema.TaggedError<
  ProjectSlugTaken,
  { readonly brand: unique symbol }
>()(
  "ProjectSlugTaken",
  { slug: ProjectSlug },
  {
    httpApiStatus: 409,
    description: "Another project already has this slug.",
  },
) {}
