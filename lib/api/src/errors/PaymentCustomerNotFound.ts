import { Schema } from "effect";

/** The caller has no Stripe customer yet: nothing was bought, so the billing portal is unavailable (404). */
export class PaymentCustomerNotFound extends Schema.TaggedError<
  PaymentCustomerNotFound,
  { readonly brand: unique symbol }
>()(
  "PaymentCustomerNotFound",
  {},
  {
    httpApiStatus: 404,
    description: "The caller has no Stripe customer yet.",
  },
) {}
