import { BlogSlug } from "@unhalteproblem.de/api";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { slugify } from "./slug.ts";

const isSlug = Schema.is(BlogSlug);

describe("slugify", () => {
  it.each([
    ["Hello World", "hello-world"],
    ["Über Effect & Nix!", "uber-effect-nix"],
    ["Straße", "strasse"],
    ["  --Leading and trailing--  ", "leading-and-trailing"],
    ["a  --  b", "a-b"],
    ["Effect v4.0.5", "effect-v4-0-5"],
  ])("%s -> %s", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it("gives slugs the contract accepts, or nothing", () => {
    for (const title of [
      "Hello",
      "ÄÖÜ äöü",
      "日本語",
      "!!!",
      "x".repeat(200),
    ]) {
      const slug = slugify(title, 64);
      if (slug !== "") expect(isSlug(slug)).toBe(true);
    }
  });

  it("cuts at the limit without leaving a trailing hyphen", () => {
    expect(slugify("aaaa bbbb", 5)).toBe("aaaa");
  });
});
