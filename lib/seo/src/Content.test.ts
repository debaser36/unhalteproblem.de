import { describe, expect, it } from "vitest";
import { blogSeo, postSeo, projectSeo } from "./Content.ts";
import { site, siteJsonLd } from "./Site.ts";

const post = {
  blog: "notes",
  slug: "hello",
  title: "Hello",
  summary: "",
  image: null,
  publishedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  authorName: null,
  tags: ["a"],
  category: "Programming",
};

describe("content SEO", () => {
  it("describes a post without summary by its author", () => {
    const seo = postSeo(post);
    expect(seo.path).toBe("/blog/notes/hello");
    expect(seo.description).toBe(`Hello, a post by ${site.owner}.`);
    expect(seo.image).toBeUndefined();
    expect(postSeo({ ...post, summary: "S", authorName: "Ann" })).toMatchObject(
      {
        description: "S",
        article: { author: "Ann" },
      },
    );
  });

  it("gives posts a BlogPosting and breadcrumbs", () => {
    const types = postSeo(post).jsonLd?.map((ld) => ld["@type"]);
    expect(types).toEqual(["BlogPosting", "BreadcrumbList"]);
  });

  it("describes blogs and projects", () => {
    expect(blogSeo({ slug: "n", title: "N", description: "D" })).toMatchObject({
      path: "/blog/n",
      title: "N",
      description: "D",
    });
    const project = projectSeo({
      slug: "p",
      title: "P",
      summary: "",
      image: "/api/media/1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      repoUrl: null,
      tags: [],
    });
    expect(project.path).toBe("/projects/p");
    expect(project.description).toBe(`P, a project by ${site.owner}.`);
    expect(project.image).toBe("/api/media/1");
  });

  it("has a site graph with a website and a person", () => {
    expect(siteJsonLd["@graph"].map((entity) => entity["@type"])).toEqual([
      "WebSite",
      "Person",
    ]);
  });
});
