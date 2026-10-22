import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import { SeoBlogQuery, SeoLimits, SeoPage } from "./Seo.ts";

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

describe("SeoBlogQuery", () => {
  const decode = Schema.decodeUnknownExit(SeoBlogQuery);
  // What the HTTP layer does with the query string: every value is a string.
  const decodeQueryString = Schema.decodeUnknownExit(
    Schema.toCodecStringTree(SeoBlogQuery),
  );

  it("limits the pages to 100", () => {
    assert.strictEqual(SeoLimits.maxPage, 100);
  });

  it("fills in page 1 when the page is absent", () => {
    assert.deepStrictEqual(decode({}), Exit.succeed({ page: 1 }));
    assert.deepStrictEqual(decodeQueryString({}), Exit.succeed({ page: 1 }));
  });

  it.each([1, 2, 99, SeoLimits.maxPage])("accepts the number %j", (page) => {
    assert.deepStrictEqual(decode({ page }), Exit.succeed({ page }));
  });

  it("accepts the page as a query string value", () => {
    assert.deepStrictEqual(
      decodeQueryString({ page: "2" }),
      Exit.succeed({ page: 2 }),
    );
    assert.deepStrictEqual(
      decodeQueryString({ page: "100" }),
      Exit.succeed({ page: 100 }),
    );
  });

  it.each([
    ["zero", 0],
    ["a negative number", -1],
    ["one beyond the maximum", SeoLimits.maxPage + 1],
    ["a fraction", 1.5],
    ["a string in the plain schema", "x"],
  ])("rejects %s", (_, page) => {
    assert.isTrue(Exit.isFailure(decode({ page })));
  });

  it.each([
    ["zero", "0"],
    ["one beyond the maximum", "101"],
    ["a fraction", "1.5"],
    ["a word", "x"],
    ["the empty string", ""],
  ])("rejects %s as a query string value", (_, page) => {
    assert.isTrue(Exit.isFailure(decodeQueryString({ page })));
  });
});
