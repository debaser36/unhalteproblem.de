import { Schema } from "effect";

/** No payment with the requested id exists (404). */
export class PaymentNotFound extends Schema.TaggedError<
  PaymentNotFound,
  { readonly brand: unique symbol }
>()(
  "PaymentNotFound",
  {
    /** The requested payment id. */
    payment: Schema.String,
  },
  {
    httpApiStatus: 404,
    description: "No payment with this id exists.",
  },
) {}
