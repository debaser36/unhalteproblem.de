import { Schema } from "effect";

/** The payment is not paid, or the amount exceeds what is left to refund (409). */
export class RefundNotAllowed extends Schema.TaggedError<
  RefundNotAllowed,
  { readonly brand: unique symbol }
>()(
  "RefundNotAllowed",
  {
    reason: Schema.Literals(["notPaid", "exceedsRemaining"]),
  },
  {
    httpApiStatus: 409,
    description: "The payment cannot be refunded this way.",
  },
) {}
