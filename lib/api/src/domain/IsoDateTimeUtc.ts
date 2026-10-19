import { Schema, SchemaTransformation } from "effect";

// In its own module so that every domain module can use it: `Auth` imports
// `Blog` (for `BlogEditorRole`), so `Blog` cannot import it from `Auth`
// without an import cycle.

/**
 * A `DateTime.Utc` encoded as an ISO 8601 UTC string. The same codec as
 * `Schema.DateTimeUtcFromString`, but with the encoded side documented as
 * `format: date-time` in JSON Schema.
 */
export const IsoDateTimeUtc = Schema.String.annotate({
  format: "date-time",
  description: "An ISO 8601 date-time in UTC, e.g. `2026-01-01T12:00:00.000Z`.",
}).pipe(
  Schema.decodeTo(
    Schema.DateTimeUtc,
    SchemaTransformation.dateTimeUtcFromString,
  ),
);
