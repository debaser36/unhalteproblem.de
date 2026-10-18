import { UserId } from "#domain/Admin";
import { Schema } from "effect";

/** The user has no active restriction to lift (409). */
export class NotRestricted extends Schema.TaggedError<
  NotRestricted,
  { readonly brand: unique symbol }
>()(
  "NotRestricted",
  { userId: UserId },
  {
    httpApiStatus: 409,
    description: "The user is not restricted.",
  },
) {}
