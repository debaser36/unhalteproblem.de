import { Schema } from "effect";

/** No payment product with the requested id exists (404). */
export class PaymentProductNotFound extends Schema.TaggedError<
  PaymentProductNotFound,
  { readonly brand: unique symbol }
>()(
  "PaymentProductNotFound",
  {
    /** The requested product id. */
    product: Schema.String,
  },
  {
    httpApiStatus: 404,
    description: "No payment product with this id exists.",
  },
) {}
