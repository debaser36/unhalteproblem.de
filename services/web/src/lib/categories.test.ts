import { describe, expect, it } from "vitest";
import { categoriesInput, cleanCategoryName } from "./categories.ts";

describe("cleanCategoryName", () => {
  it("collapses and trims whitespace", () => {
    expect(cleanCategoryName("  Web   Development ")).toBe("Web Development");
  });
});

describe("categoriesInput", () => {
  it("requires a main category", () => {
    expect(categoriesInput("  ", [])).toBe("Choose a main category.");
  });

  it("drops empty extras and extras repeating the main or each other", () => {
    expect(
      categoriesInput("Web Development", [
        "",
        "web-development",
        "Security",
        "security",
      ]),
    ).toEqual({ main: "Web Development", extra: ["Security"] });
  });

  it("allows at most three extras", () => {
    expect(categoriesInput("A", ["B", "C", "D", "E"])).toBe(
      "At most 3 more categories.",
    );
  });

  it("refuses names without letters or digits and overlong names", () => {
    expect(categoriesInput("!!!", [])).toMatch(/at least one letter/);
    expect(categoriesInput("x".repeat(49), [])).toMatch(/at most 48/);
  });
});
