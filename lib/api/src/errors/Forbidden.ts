import { Schema } from "effect";

/**
 * The request was understood but is not allowed (403).
 *
 * Used as CSRF protection: a state-changing request authenticated by a
 * cookie (such as `POST /auth/logout`) is rejected when its `Origin` header is
 * missing or not the website's own. It has no fields; a legitimate client
 * never sees it.
 */
export class Forbidden extends Schema.TaggedError<
  Forbidden,
  { readonly brand: unique symbol }
>()(
  "Forbidden",
  {},
  {
    httpApiStatus: 403,
    description: "The request is not allowed, e.g. from a foreign origin.",
  },
) {}
