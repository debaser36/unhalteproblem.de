import { describe, expect, it } from "vitest";
import { escapeHtml, renderDocument } from "./Html.ts";
import { buildSeo } from "./Tags.ts";

const site = {
  origin: "https://example.org",
  name: "example.org",
  tagline: "a tagline",
  description: "The default description.",
  image: "/og.png",
};

describe("escapeHtml", () => {
  it("escapes everything that can leave text or an attribute", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;",
    );
  });
});

describe("renderDocument", () => {
  it("puts the tags in the head and the body after it", () => {
    const html = renderDocument(
      buildSeo(site, { title: "T", path: "/t", jsonLd: [{ a: 1 }] }),
      "<h1>T</h1>",
    );
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>T · example.org</title>");
    expect(html).toContain(
      '<link rel="canonical" href="https://example.org/t">',
    );
    expect(html).toContain(
      '<script type="application/ld+json">{"a":1}</script>',
    );
    expect(html.indexOf("</head>")).toBeLessThan(html.indexOf("<h1>T</h1>"));
  });

  it("escapes hostile titles and descriptions in the head", () => {
    const html = renderDocument(
      buildSeo(site, {
        title: '</title><script>alert("x")</script>',
        description: '"><script>alert(1)</script>',
        path: "/x",
        jsonLd: [{ name: "</script><script>alert(1)</script>" }],
      }),
      "",
    );
    expect(html).not.toMatch(/<script>alert/);
    expect(html.match(/<script/g)).toHaveLength(1);
  });
});
