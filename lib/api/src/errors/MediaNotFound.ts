import { Schema } from "effect";

/** No uploaded image has the requested `MediaId` (404). */
export class MediaNotFound extends Schema.TaggedError<
  MediaNotFound,
  { readonly brand: unique symbol }
>()(
  "MediaNotFound",
  {},
  {
    httpApiStatus: 404,
    description: "No image with this id exists.",
  },
) {}
