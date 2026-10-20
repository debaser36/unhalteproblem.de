import { DateTime } from "effect";
import { describe, expect, it } from "vitest";
import { formatBytes, isoDate } from "./format.ts";

describe("format", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1536, "1.5 KiB"],
    [8_674_327, "8.3 MiB"],
    [50 * 1024 * 1024, "50 MiB"],
  ])("formatBytes(%i) = %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  it("gives the calendar date of an instant in UTC", () => {
    expect(isoDate(DateTime.makeUnsafe("2026-10-19T23:30:00Z"))).toBe(
      "2026-10-19",
    );
  });
});
