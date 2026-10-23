import { Schema } from "effect";

/** The price is unknown, inactive or not offered (404). */
export class PaymentPriceNotFound extends Schema.TaggedError<
  PaymentPriceNotFound,
  { readonly brand: unique symbol }
>()(
  "PaymentPriceNotFound",
  {
    /** The requested price id. */
    price: Schema.String,
  },
  {
    httpApiStatus: 404,
    description: "This price does not exist, is inactive or is not offered.",
  },
) {}
