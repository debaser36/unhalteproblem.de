import { Schema } from "effect";
import * as Outbox from "#cqrs/Outbox";

/**
 * A verified Stripe webhook event, to be mirrored: the ids it is about,
 * never its object (the consumer fetches the current state from Stripe).
 */
export const HandleStripeEvent = Outbox.topic(
  "payments.stripe-event",
  Schema.Struct({
    eventId: Schema.String,
    type: Schema.String,
    refs: Schema.Struct({
      productId: Schema.optionalKey(Schema.String),
      checkoutSessionId: Schema.optionalKey(Schema.String),
      subscriptionId: Schema.optionalKey(Schema.String),
      invoiceId: Schema.optionalKey(Schema.String),
      paymentIntentId: Schema.optionalKey(Schema.String),
    }),
  }),
);

/**
 * Cancel the live subscriptions of a Stripe customer whose user deleted
 * their account. The payload is Stripe's customer id; no profile data.
 */
export const CancelCustomerSubscriptions = Outbox.topic(
  "payments.cancel-subscriptions",
  Schema.Struct({ customerId: Schema.String }),
);
