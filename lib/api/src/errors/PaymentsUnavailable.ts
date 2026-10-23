import { Schema } from "effect";

/** Stripe is not configured (no secret key or webhook secret) (503). No fields: the reason is nothing to reveal to clients. */
export class PaymentsUnavailable extends Schema.TaggedError<
  PaymentsUnavailable,
  { readonly brand: unique symbol }
>()(
  "PaymentsUnavailable",
  {},
  {
    httpApiStatus: 503,
    description: "Payments are not configured on this server.",
  },
) {}
