import { describe, expect, it } from "vitest";
import { parseTags } from "./tags.ts";

describe("parseTags", () => {
  it("splits on commas and spaces, slugifies and removes duplicates", () => {
    expect(parseTags("Effect, nix  TypeScript,effect")).toEqual([
      "effect",
      "nix",
      "typescript",
    ]);
  });

  it("keeps at most 10", () => {
    expect(parseTags("a b c d e f g h i j k l")).toHaveLength(10);
  });

  it("drops what is left empty", () => {
    expect(parseTags(" , !!, ")).toEqual([]);
  });
});
