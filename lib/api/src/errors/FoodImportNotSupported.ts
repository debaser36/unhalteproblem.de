import { FoodCountry, FoodImportSource } from "#domain/Food";
import { Schema } from "effect";

/**
 * The import source has no data for the country (422): Stats NZ, for
 * example, only covers New Zealand.
 */
export class FoodImportNotSupported extends Schema.TaggedError<
  FoodImportNotSupported,
  { readonly brand: unique symbol }
>()(
  "FoodImportNotSupported",
  {
    country: FoodCountry,
    source: FoodImportSource,
  },
  {
    httpApiStatus: 422,
    description: "The source has no data for this country.",
  },
) {}
