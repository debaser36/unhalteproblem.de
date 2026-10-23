import { Schema } from "effect";

/** Another product is the tip product already, or a tip product would get roles (409). */
export class ProductKindConflict extends Schema.TaggedError<
  ProductKindConflict,
  { readonly brand: unique symbol }
>()(
  "ProductKindConflict",
  {},
  {
    httpApiStatus: 409,
    description:
      "Another product is the tip product, or a tip product would get roles.",
  },
) {}
