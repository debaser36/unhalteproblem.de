/**
 * Building blocks of the text fields of blogs, posts and projects. Internal
 * to the contract: the exported schemas use them, clients don't need them.
 */
import { Schema } from "effect";

// Postgres `text` cannot store U+0000, so NUL is rejected here instead of
// failing in the database with a 500. The `u` flag is required for
// `Schema.isPattern` to export the pattern to JSON Schema.
// oxlint-disable-next-line no-control-regex -- matching NUL is the point
const NO_NUL_PATTERN = /^[^\u0000]*$/u;

/** Rejects text containing NUL (U+0000), which Postgres `text` cannot store. */
export const noNul = Schema.isPattern(NO_NUL_PATTERN, {
  expected: "text without NUL characters",
});

// Lowercase ASCII letters and digits in groups separated by single hyphens:
// no leading, trailing or doubled "-".
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * A slug of 1 to `maxLength` lowercase ASCII letters and digits in groups
 * separated by single hyphens, e.g. `rust-notes`. Without identifier and
 * description: annotate the result.
 *
 * @param example shown in the error message, e.g. `"rust-notes"`
 */
export const slugString = (maxLength: number, example: string) =>
  Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(maxLength),
    Schema.isPattern(SLUG_PATTERN, {
      expected:
        "lowercase ASCII letters and digits in groups separated by single " +
        `hyphens, e.g. "${example}"`,
    }),
  );
