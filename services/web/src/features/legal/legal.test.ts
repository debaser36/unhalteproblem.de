import { describe, expect, it } from "vitest";
import { parseLanguage } from "./legal.ts";

describe("parseLanguage", () => {
  it("reads English from ?lang=en", () => {
    expect(parseLanguage("en")).toBe("en");
  });

  it("falls back to German, the binding version", () => {
    expect(parseLanguage(null)).toBe("de");
    expect(parseLanguage("de")).toBe("de");
    expect(parseLanguage("fr")).toBe("de");
    expect(parseLanguage("EN")).toBe("de");
  });
});
