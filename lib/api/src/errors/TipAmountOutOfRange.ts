import { PaymentMoney } from "#domain/Payment";
import { Schema } from "effect";

/** A custom tip amount is outside the allowed range (400). */
export class TipAmountOutOfRange extends Schema.TaggedError<
  TipAmountOutOfRange,
  { readonly brand: unique symbol }
>()(
  "TipAmountOutOfRange",
  {
    minimum: PaymentMoney,
    maximum: PaymentMoney,
  },
  {
    httpApiStatus: 400,
    description: "The tip is below the minimum or above the maximum.",
  },
) {}
