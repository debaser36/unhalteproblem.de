import { Schema } from "effect";

/**
 * The upload body is not a multipart form with exactly one file part named
 * `file` (400).
 */
export class InvalidUpload extends Schema.TaggedError<
  InvalidUpload,
  { readonly brand: unique symbol }
>()(
  "InvalidUpload",
  {},
  {
    httpApiStatus: 400,
    description:
      "The body is not a multipart form with exactly one file part named " +
      "`file`.",
  },
) {}
