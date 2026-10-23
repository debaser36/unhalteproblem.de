import { Schema } from "effect";

/** The Stripe webhook signature is missing, malformed or does not match (400). */
export class InvalidWebhookSignature extends Schema.TaggedError<
  InvalidWebhookSignature,
  { readonly brand: unique symbol }
>()(
  "InvalidWebhookSignature",
  {},
  {
    httpApiStatus: 400,
    description: "The webhook signature is missing or invalid.",
  },
) {}
