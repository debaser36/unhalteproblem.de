import { Schema } from "effect";

/** Length limit of `BlogSlug`. */
export const BlogSlugMaxLength = 64;

// Lowercase ASCII letters and digits in groups separated by single hyphens:
// no leading, trailing or doubled "-". The `u` flag is required for
// `Schema.isPattern` to export the pattern to JSON Schema.
const BLOG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * `BlogSlug` without its identifier, as a part of template literals such as
 * `BlogEditorRole`: JSON Schema generation (effect 4.0.5) cannot turn a part
 * with an identifier, i.e. a `$ref`, into a pattern and throws.
 */
export const BlogSlugPart = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(BlogSlugMaxLength),
  Schema.isPattern(BLOG_SLUG_PATTERN, {
    expected:
      "lowercase ASCII letters and digits in groups separated by single " +
      'hyphens, e.g. "rust-notes"',
  }),
);

/**
 * The URL slug of a subblog, e.g. `rust-notes`: 1 to 64 lowercase ASCII
 * letters and digits, in groups separated by single hyphens.
 *
 * Deliberately not branded, so it can be a part of the template literal
 * `BlogEditorRole` (`blogEditor:<slug>`, built with `BlogSlugPart`).
 */
export const BlogSlug = BlogSlugPart.annotate({
  identifier: "BlogSlug",
  description: "URL slug of a subblog, e.g. `rust-notes`",
});
export type BlogSlug = typeof BlogSlug.Type;
