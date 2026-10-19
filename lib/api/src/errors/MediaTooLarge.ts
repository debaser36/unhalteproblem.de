import { Schema } from "effect";

/** The upload exceeds `MediaLimits.maxBytes` (5 MiB) (413). */
export class MediaTooLarge extends Schema.TaggedError<
  MediaTooLarge,
  { readonly brand: unique symbol }
>()(
  "MediaTooLarge",
  {},
  {
    httpApiStatus: 413,
    description: "The upload is larger than 5 MiB.",
  },
) {}
