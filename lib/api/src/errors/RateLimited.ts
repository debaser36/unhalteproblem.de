import { Schema } from "effect";

/**
 * The client sent too many requests and should retry later (429).
 *
 * Declared now so a server-side limiter can be added without changing the
 * contract. It has no fields yet; an optional `retryAfterSeconds` (or a
 * `Retry-After` header) can be added later as a compatible change.
 */
export class RateLimited extends Schema.TaggedError<
  RateLimited,
  { readonly brand: unique symbol }
>()(
  "RateLimited",
  {},
  {
    httpApiStatus: 429,
    description: "Too many requests. Try again later.",
  },
) {}
