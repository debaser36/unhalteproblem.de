import { FoodImportId } from "#domain/Food";
import { Schema } from "effect";

/**
 * An import of the same country and source is already queued or running
 * (409). Follow that one with `foodPlanner.getFoodImport` instead of
 * starting another.
 */
export class FoodImportAlreadyRunning extends Schema.TaggedError<
  FoodImportAlreadyRunning,
  { readonly brand: unique symbol }
>()(
  "FoodImportAlreadyRunning",
  {
    /** The queued or running import. */
    importId: FoodImportId,
  },
  {
    httpApiStatus: 409,
    description:
      "An import of this country and source is already queued or running.",
  },
) {}
