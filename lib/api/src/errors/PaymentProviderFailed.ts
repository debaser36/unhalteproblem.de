import { Schema } from "effect";

/** A call to Stripe failed (502). */
export class PaymentProviderFailed extends Schema.TaggedError<
  PaymentProviderFailed,
  { readonly brand: unique symbol }
>()(
  "PaymentProviderFailed",
  {
    /** A short code of what failed. */
    reason: Schema.String,
  },
  {
    httpApiStatus: 502,
    description: "A call to the payment provider failed.",
  },
) {}
