import { Schema } from "effect";

/**
 * The uploaded file is not one of the allowed image types (415), as
 * detected from its content (magic bytes), whatever its declared type.
 */
export class UnsupportedMedia extends Schema.TaggedError<
  UnsupportedMedia,
  { readonly brand: unique symbol }
>()(
  "UnsupportedMedia",
  {},
  {
    httpApiStatus: 415,
    description: "The file is not a PNG, JPEG, WebP, GIF or AVIF image.",
  },
) {}
