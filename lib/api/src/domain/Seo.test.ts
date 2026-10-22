import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import { SeoPage } from "./Seo.ts";

describe("SeoPage", () => {
  const decode = Schema.decodeUnknownExit(SeoPage);
  const pages: ReadonlyArray<SeoPage> = [
    "home",
    "about",
    "contact",
    "blog",
    "projects",
  ];

  it.each(pages)("accepts %j, unchanged", (page) => {
    assert.deepStrictEqual(decode(page), Exit.succeed(page));
  });

  it("accepts exactly the five pages", () => {
    assert.deepStrictEqual([...SeoPage.literals].sort(), [...pages].sort());
  });

  it.each([
    ["an unknown page", "imprint"],
    ["another case", "Home"],
    ["the singular of a page", "project"],
    ["a path", "/blog"],
    ["an empty string", ""],
    ["a number", 1],
    ["null", null],
  ])("rejects %s", (_, value) => {
    assert.isTrue(Exit.isFailure(decode(value)));
  });
});
