import { Schema } from "effect";

/**
 * The request was understood but is not allowed (403). It has no fields.
 *
 * Used for:
 *
 * - CSRF protection: a state-changing request authenticated by a cookie
 *   (such as `POST /auth/logout`) is rejected when its `Origin` header is
 *   missing or not the website's own. A legitimate client never sees this.
 * - Authorization: a logged-in user lacks the roles an endpoint requires
 *   (see `RequireRoles`). Without a session, `Unauthorized` (401) comes
 *   first.
 */
export class Forbidden extends Schema.TaggedError<
  Forbidden,
  { readonly brand: unique symbol }
>()(
  "Forbidden",
  {},
  {
    httpApiStatus: 403,
    description:
      "The request is not allowed, e.g. from a foreign origin or without " +
      "the required role.",
  },
) {}
