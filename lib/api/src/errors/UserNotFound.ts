import { UserId } from "#domain/Admin";
import { Schema } from "effect";

/** No user has the requested `UserId` (404). */
export class UserNotFound extends Schema.TaggedError<
  UserNotFound,
  { readonly brand: unique symbol }
>()(
  "UserNotFound",
  { userId: UserId },
  {
    httpApiStatus: 404,
    description: "No user with this id exists.",
  },
) {}
