import { Schema } from "effect";

/**
 * The caller already has a live subscription (any status but canceled or
 * incompleteExpired) or a paid or pending purchase of the product (409).
 *
 * `purchased` never applies to a product that grants credits: those can be
 * bought repeatedly (each purchase grants its credits again). `subscribed`
 * still applies to subscriptions.
 */
export class AlreadyEntitled extends Schema.TaggedError<
  AlreadyEntitled,
  { readonly brand: unique symbol }
>()(
  "AlreadyEntitled",
  {
    /** The product id. */
    product: Schema.String,
    reason: Schema.Literals(["subscribed", "purchased"]),
  },
  {
    httpApiStatus: 409,
    description:
      "The caller already has a subscription or a purchase of this product.",
  },
) {}
