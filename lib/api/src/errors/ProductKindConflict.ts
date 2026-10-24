import { Schema } from "effect";

/**
 * Another product is the tip product already, or a tip product would get
 * roles or credits, or a product would grant both roles and credits (409).
 * A product grants roles or credits, never both: setting credits on a
 * product with roles, or roles on one with credits, is refused, as is
 * anything granted by the tip product.
 */
export class ProductKindConflict extends Schema.TaggedError<
  ProductKindConflict,
  { readonly brand: unique symbol }
>()(
  "ProductKindConflict",
  {},
  {
    httpApiStatus: 409,
    description:
      "Another product is the tip product, a tip product would get roles " +
      "or credits, or a product would grant both roles and credits.",
  },
) {}
