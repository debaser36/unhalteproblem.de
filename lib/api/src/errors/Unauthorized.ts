import { Schema } from "effect";

/**
 * The request needs a logged-in session, and there is none (401): the
 * session cookie is missing, unknown or expired.
 *
 * Raised by the `Authentication` middleware. It has no fields on purpose:
 * the client only needs to know that it should start a login, and the
 * reason (no cookie, expired, revoked) is nothing to reveal to it.
 */
export class Unauthorized extends Schema.TaggedError<
  Unauthorized,
  { readonly brand: unique symbol }
>()(
  "Unauthorized",
  {},
  {
    httpApiStatus: 401,
    description: "Not logged in, or the session has expired.",
  },
) {}
