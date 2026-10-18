import { Schema } from "effect";

/**
 * The service is running but cannot do its work right now (503), for example
 * because the database does not answer.
 *
 * Returned by `GET /ready`. The endpoint encodes it without a body (see
 * `HttpApiSchema.asNoContent` in the `system` group): probes only look at the
 * status code, and the reason (which dependency failed) is nothing to reveal
 * to an unauthenticated caller. It has no fields on purpose.
 */
export class ServiceUnavailable extends Schema.TaggedError<
  ServiceUnavailable,
  { readonly brand: unique symbol }
>()(
  "ServiceUnavailable",
  {},
  {
    httpApiStatus: 503,
    description: "The service is not ready to handle requests.",
  },
) {}
