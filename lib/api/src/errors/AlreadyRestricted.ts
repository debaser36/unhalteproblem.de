import { UserId } from "#domain/Admin";
import { Schema } from "effect";

/**
 * The user already has an active restriction (409); a user has at most one
 * at a time. Lift it first to restrict the account again with a new note.
 */
export class AlreadyRestricted extends Schema.TaggedError<
  AlreadyRestricted,
  { readonly brand: unique symbol }
>()(
  "AlreadyRestricted",
  { userId: UserId },
  {
    httpApiStatus: 409,
    description: "The user is already restricted.",
  },
) {}
