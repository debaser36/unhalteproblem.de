import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  blogPostingJsonLd,
  breadcrumbsJsonLd,
  buildSeo,
  canonicalUrl,
  maxDescriptionLength,
  projectJsonLd,
  serializeJsonLd,
  toDescription,
} from "./Tags.ts";

const site = {
  origin: "https://example.org",
  name: "example.org",
  tagline: "a tagline",
  description: "The default description.",
  image: "/og.png",
};

const meta = (tags: ReturnType<typeof buildSeo>, key: string) =>
  tags.meta.filter((m) => m.key === key).map((m) => m.content);

describe("toDescription", () => {
  it("collapses whitespace and keeps short text", () => {
    expect(toDescription("  a \n  b\t c ")).toBe("a b c");
  });

  it("cuts long text at a word with an ellipsis", () => {
    const result = toDescription("word ".repeat(100));
    expect(result.length).toBeLessThanOrEqual(maxDescriptionLength);
    expect(result.endsWith("word…")).toBe(true);
  });

  it("hard-cuts text without spaces", () => {
    const result = toDescription("x".repeat(500));
    expect(result).toHaveLength(maxDescriptionLength);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("urls", () => {
  it("makes paths absolute and keeps absolute urls", () => {
    expect(absoluteUrl(site.origin, "/a.png")).toBe(
      "https://example.org/a.png",
    );
    expect(absoluteUrl(site.origin, "a.png")).toBe("https://example.org/a.png");
    expect(absoluteUrl(site.origin, "https://cdn.test/a.png")).toBe(
      "https://cdn.test/a.png",
    );
  });

  it.each([
    ["/", "https://example.org/"],
    ["/blog", "https://example.org/blog"],
    ["/blog/", "https://example.org/blog"],
    ["/blog/notes?category=security#top", "https://example.org/blog/notes"],
    ["/?x=1", "https://example.org/"],
  ])("canonicalizes %s", (path, expected) => {
    expect(canonicalUrl(site.origin, path)).toBe(expected);
  });
});

describe("serializeJsonLd", () => {
  it("cannot end the script element", () => {
    const json = serializeJsonLd({ name: "</script><script>alert(1)" });
    expect(json).not.toContain("<");
    expect(JSON.parse(json)).toEqual({ name: "</script><script>alert(1)" });
  });
});

describe("buildSeo", () => {
  it("titles the home page with the tagline", () => {
    const tags = buildSeo(site, { path: "/" });
    expect(tags.title).toBe("example.org — a tagline");
    expect(meta(tags, "og:title")).toEqual(["example.org"]);
    expect(meta(tags, "description")).toEqual(["The default description."]);
    expect(meta(tags, "og:image")).toEqual(["https://example.org/og.png"]);
    expect(meta(tags, "robots")).toEqual([
      "index, follow, max-image-preview:large",
    ]);
  });

  it("appends the site name to page titles", () => {
    const tags = buildSeo(site, { title: "About", path: "/about" });
    expect(tags.title).toBe("About · example.org");
    expect(meta(tags, "og:title")).toEqual(["About"]);
    expect(tags.canonical).toBe("https://example.org/about");
  });

  it("noindexes private pages", () => {
    const tags = buildSeo(site, {
      title: "Admin",
      path: "/admin",
      noindex: true,
    });
    expect(meta(tags, "robots")).toEqual(["noindex, nofollow"]);
  });

  it("can noindex a page and still follow its links", () => {
    const tags = buildSeo(site, {
      path: "/blog/b",
      noindex: true,
      follow: true,
    });
    expect(meta(tags, "robots")).toEqual(["noindex, follow"]);
  });

  it("describes articles", () => {
    const tags = buildSeo(site, {
      title: "Post",
      path: "/blog/b/p",
      image: "/api/media/1",
      article: {
        publishedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        author: "Nico",
        tags: ["a", "b"],
      },
    });
    expect(meta(tags, "og:type")).toEqual(["article"]);
    expect(meta(tags, "article:published_time")).toEqual([
      "2026-01-01T00:00:00.000Z",
    ]);
    expect(meta(tags, "article:tag")).toEqual(["a", "b"]);
    expect(meta(tags, "author")).toEqual(["Nico"]);
    expect(meta(tags, "og:image")).toEqual(["https://example.org/api/media/1"]);
  });

  it("serializes structured data safely", () => {
    const tags = buildSeo(site, {
      path: "/",
      jsonLd: [{ "@type": "Thing", name: "</script>" }],
    });
    expect(tags.jsonLd).toHaveLength(1);
    expect(tags.jsonLd[0]).not.toContain("<");
  });
});

describe("structured data", () => {
  it("numbers breadcrumbs from 1 with canonical urls", () => {
    const ld = breadcrumbsJsonLd(site.origin, [
      { name: "Home", path: "/" },
      { name: "Blog", path: "/blog/" },
    ]);
    expect(ld.itemListElement.map((item) => item.position)).toEqual([1, 2]);
    expect(ld.itemListElement.map((item) => item.item)).toEqual([
      "https://example.org/",
      "https://example.org/blog",
    ]);
  });

  it("leaves out what a post does not have", () => {
    const ld = blogPostingJsonLd(site.origin, {
      path: "/blog/b/p",
      title: "T",
      description: "D",
      image: undefined,
      publishedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      author: null,
      tags: [],
      section: "Security",
    });
    expect(ld).not.toHaveProperty("image");
    expect(ld).not.toHaveProperty("author");
    expect(ld).not.toHaveProperty("keywords");
    expect(ld.mainEntityOfPage).toBe("https://example.org/blog/b/p");
  });

  it("types a project by its repository", () => {
    const base = {
      path: "/projects/p",
      title: "P",
      description: "D",
      image: "/api/media/1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      tags: ["x"],
    };
    const withRepo = projectJsonLd(site.origin, {
      ...base,
      repoUrl: "https://github.com/a/b",
    });
    expect(withRepo["@type"]).toBe("SoftwareSourceCode");
    expect(withRepo).toHaveProperty("codeRepository", "https://github.com/a/b");
    expect(
      projectJsonLd(site.origin, { ...base, repoUrl: null })["@type"],
    ).toBe("CreativeWork");
  });
});
