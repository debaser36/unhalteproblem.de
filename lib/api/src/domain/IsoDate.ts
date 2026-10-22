import { Schema } from "effect";

// The `u` flag is required for `Schema.isPattern` to export the pattern to
// JSON Schema.
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** Whether `YYYY-MM-DD` names a day that exists (no 30 February). */
const isExistingDay = (value: string): boolean => {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  // `Date.UTC` maps the years 0 to 99 to 1900 to 1999; `setUTCFullYear`
  // does not.
  date.setUTCFullYear(year);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

/**
 * A calendar date without a time or time zone, as an ISO 8601 string
 * `YYYY-MM-DD`, e.g. `2026-10-22`. Kept as a string on both sides: it names
 * a day, not an instant (see `IsoDateTimeUtc` for those).
 */
export const IsoDate = Schema.String.check(
  Schema.isPattern(ISO_DATE_PATTERN, {
    expected: 'a calendar date "YYYY-MM-DD"',
  }),
  Schema.makeFilter(
    (value: string) => isExistingDay(value) || "a calendar date that exists",
    { expected: "a calendar date that exists" },
  ),
).annotate({
  identifier: "IsoDate",
  format: "date",
  description: "An ISO 8601 calendar date, `YYYY-MM-DD`, e.g. `2026-10-22`.",
});
export type IsoDate = typeof IsoDate.Type;
