import { Schema } from "effect";

/** No enabled tip product exists (404). */
export class TipsUnavailable extends Schema.TaggedError<
  TipsUnavailable,
  { readonly brand: unique symbol }
>()(
  "TipsUnavailable",
  {},
  {
    httpApiStatus: 404,
    description: "There is no tip product.",
  },
) {}
