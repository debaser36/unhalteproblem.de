import {
  Api,
  HttpUrl,
  mediaUrl,
  type PostCursorPosition,
} from "@unhalteproblem.de/api";
import {
  blogSeo,
  buildSeo,
  canonicalUrl,
  escapeHtml,
  postSeo,
  projectSeo,
  renderDocument,
  type SeoInput,
  site,
  siteJsonLd,
  staticPages,
} from "@unhalteproblem.de/seo";
import { DateTime, Effect, Option, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import type { BlogSlug } from "#domains/blogs/Blog";
import { BlogQueries } from "#domains/blogs/BlogQueries";
import { ProjectQueries } from "#domains/projects/ProjectQueries";
import { toPublishedPost } from "./BlogViews.ts";
import { documentHtml } from "./DocumentHtml.ts";
import { toPublishedProject } from "./ProjectViews.ts";

// These pages are served from the site's own origin and show user-written
// content, so the browser is told to run and load nothing from them, even
// when someone opens one directly (`/api/seo/...` is public).
const headers = {
  "cache-control": "public, max-age=300",
  "content-security-policy":
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  "x-content-type-options": "nosniff",
} as const;

const page = (html: string) =>
  HttpServerResponse.text(html, {
    contentType: "text/html; charset=utf-8",
    headers,
  });

const isHttpUrl = Schema.is(HttpUrl);

/** A link to an address from the database, checked once more. */
const externalLink = (url: string, text: string) =>
  isHttpUrl(url) ? ` · ${link(url, text)}` : "";

const link = (path: string, text: string) =>
  `<a href="${escapeHtml(path)}">${escapeHtml(text)}</a>`;

const nav = [
  link("/", "Home"),
  link("/blog", "Blog"),
  link("/projects", "Projects"),
  link("/about", "About"),
  link("/contact", "Contact"),
].join(" · ");

const render = (input: SeoInput, main: string) =>
  page(
    renderDocument(
      buildSeo(site, input),
      `<header><nav>${nav}</nav></header>\n<main>\n${main}\n</main>`,
    ),
  );

/** How many posts a listing page names; the rest is a click away. */
const listed = 50;

/** The most URLs a sitemap may have (sitemaps.org). */
const sitemapLimit = 50000;

/** Posts per query while collecting them all for the sitemap. */
const sitemapBatch = 500;

/** How long a built sitemap is reused. */
const sitemapTtl = "5 minutes";

const list = (items: ReadonlyArray<string>) =>
  items.length === 0
    ? ""
    : `<ul>\n${items.map((i) => `<li>${i}</li>`).join("\n")}\n</ul>`;

const dateOf = (date: DateTime.DateTime) => DateTime.formatIso(date);

/**
 * The pages crawlers and link previews get instead of the SPA's empty
 * shell: the same text, plus the head tags and structured data the SPA sets
 * with JavaScript. nginx routes only crawler requests here.
 */
export const SeoHandlers = HttpApiBuilder.group(
  Api,
  "seo",
  Effect.fn(function* (handlers) {
    const blogs = yield* BlogQueries;
    const projects = yield* ProjectQueries;

    const newest = (blog: Option.Option<BlogSlug>, limit: number) =>
      blogs.feed({
        blog,
        tag: Option.none(),
        category: Option.none(),
        author: Option.none(),
        sort: "newest",
        after: Option.none(),
        limit,
      });

    // Many queries and a large string: built at most once per `sitemapTtl`,
    // however often crawlers (or anyone else) ask. Posts come last, so that a
    // sitemap over the limit loses the oldest posts, not the fixed pages,
    // blogs or projects.
    const buildSitemap = Effect.gen(function* () {
      const urls: Array<{ readonly path: string; readonly lastmod?: string }> =
        Object.values(staticPages).map(({ path }) => ({ path }));
      for (const blog of yield* blogs.listBlogs) {
        urls.push({
          path: `/blog/${blog.slug}`,
          lastmod: dateOf(blog.latestPostAt ?? blog.createdAt),
        });
      }
      for (const project of yield* projects.listPublished) {
        urls.push({
          path: `/projects/${project.slug}`,
          lastmod: dateOf(project.updatedAt),
        });
      }
      let after = Option.none<PostCursorPosition>();
      let truncated = false;
      while (!truncated) {
        const batch = yield* blogs
          .feed({
            blog: Option.none(),
            tag: Option.none(),
            category: Option.none(),
            author: Option.none(),
            sort: "newest",
            after,
            limit: Math.min(sitemapBatch, sitemapLimit - urls.length),
          })
          .pipe(Effect.catchTag("BlogNotFound", Effect.die));
        for (const { post, blog } of batch.posts) {
          urls.push({
            path: `/blog/${blog}/${post.slug}`,
            lastmod: dateOf(post.updatedAt),
          });
        }
        if (Option.isNone(batch.next)) break;
        truncated = urls.length >= sitemapLimit;
        after = batch.next;
      }
      if (truncated) {
        yield* Effect.logWarning(
          `The sitemap is over ${sitemapLimit} URLs; the oldest posts are left out`,
        );
      }
      return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls.map(
          ({ path, lastmod }) =>
            `<url><loc>${escapeHtml(canonicalUrl(site.origin, path))}</loc>${
              lastmod === undefined
                ? ""
                : `<lastmod>${escapeHtml(lastmod)}</lastmod>`
            }</url>`,
        ),
        "</urlset>",
        "",
      ].join("\n");
    });
    const sitemap = yield* Effect.cachedWithTTL(buildSitemap, sitemapTtl);

    return handlers
      .handle("renderPage", ({ params }) =>
        Effect.gen(function* () {
          const meta: {
            readonly title?: string;
            readonly description?: string;
            readonly path: string;
          } = staticPages[params.page];
          const heading = escapeHtml(meta.title ?? site.name);
          const text = escapeHtml(meta.description ?? site.description);
          let extra = "";
          if (params.page === "home") {
            const { posts } = yield* newest(Option.none(), 10).pipe(
              Effect.catchTag("BlogNotFound", Effect.die),
            );
            extra = `<h2>Latest posts</h2>\n${list(
              posts.map(
                ({ post, blog }) =>
                  `${link(`/blog/${blog}/${post.slug}`, post.title)}${
                    post.summary === "" ? "" : ` — ${escapeHtml(post.summary)}`
                  }`,
              ),
            )}`;
          } else if (params.page === "blog") {
            const all = yield* blogs.listBlogs;
            extra = list(
              all.map(
                (blog) =>
                  `${link(`/blog/${blog.slug}`, blog.title)} — ${escapeHtml(blog.description)}`,
              ),
            );
          } else if (params.page === "projects") {
            const all = yield* projects.listPublished;
            extra = list(
              all.map(
                (project) =>
                  `${link(`/projects/${project.slug}`, project.title)} — ${escapeHtml(project.summary)}`,
              ),
            );
          }
          return render(
            {
              ...meta,
              ...(params.page === "home" ? { jsonLd: [siteJsonLd] } : {}),
            },
            `<h1>${heading}</h1>\n<p>${text}</p>\n${extra}`,
          );
        }),
      )
      .handle("renderBlog", ({ params }) =>
        Effect.gen(function* () {
          const info = yield* blogs.getBlog(params.blog);
          const { posts } = yield* newest(Option.some(params.blog), listed);
          return render(
            blogSeo(info),
            `<h1>${escapeHtml(info.title)}</h1>\n<p>${escapeHtml(info.description)}</p>\n<p>${escapeHtml(info.categories.main.name)}</p>\n${list(
              posts.map(
                ({ post }) =>
                  `${link(`/blog/${params.blog}/${post.slug}`, post.title)}${
                    post.summary === "" ? "" : ` — ${escapeHtml(post.summary)}`
                  }`,
              ),
            )}`,
          );
        }),
      )
      .handle("renderPost", ({ params }) =>
        blogs.getPublished(params.blog, params.post).pipe(
          Effect.map(toPublishedPost),
          Effect.map((post) => {
            const published = dateOf(post.publishedAt);
            const author = post.author.name;
            return render(
              postSeo({
                blog: post.blog,
                slug: post.slug,
                title: post.title,
                summary: post.summary,
                image:
                  post.coverImage === null ? null : mediaUrl(post.coverImage),
                publishedAt: published,
                updatedAt: dateOf(post.updatedAt),
                authorName: author,
                tags: post.tags,
                category: post.categories.main.name,
              }),
              `<article>\n<h1>${escapeHtml(post.title)}</h1>\n${
                post.summary === ""
                  ? ""
                  : `<p>${escapeHtml(post.summary)}</p>\n`
              }<p>${link(`/blog/${post.blog}`, post.blog)} · <time datetime="${escapeHtml(published)}">${escapeHtml(published.slice(0, 10))}</time>${
                author === null ? "" : ` · ${escapeHtml(author)}`
              } · ${post.readingMinutes} min read</p>\n${
                post.coverImage === null
                  ? ""
                  : `<img src="${escapeHtml(mediaUrl(post.coverImage))}" alt="">\n`
              }${documentHtml(post.content)}\n</article>`,
            );
          }),
        ),
      )
      .handle("renderProject", ({ params }) =>
        projects.getPublished(params.project).pipe(
          Effect.map(toPublishedProject),
          Effect.map((project) =>
            render(
              projectSeo({
                slug: project.slug,
                title: project.title,
                summary: project.summary,
                image:
                  project.coverImage === null
                    ? null
                    : mediaUrl(project.coverImage),
                updatedAt: dateOf(project.updatedAt),
                repoUrl: project.repoUrl,
                tags: project.tags,
              }),
              `<article>\n<h1>${escapeHtml(project.title)}</h1>\n${
                project.summary === ""
                  ? ""
                  : `<p>${escapeHtml(project.summary)}</p>\n`
              }<p>${escapeHtml(project.status)}${project.repoUrl === null ? "" : externalLink(project.repoUrl, "source")}${project.liveUrl === null ? "" : externalLink(project.liveUrl, "live")}</p>\n${
                project.coverImage === null
                  ? ""
                  : `<img src="${escapeHtml(mediaUrl(project.coverImage))}" alt="">\n`
              }${documentHtml(project.content)}\n</article>`,
            ),
          ),
        ),
      )
      .handle("getSitemap", () =>
        sitemap.pipe(
          Effect.map((xml) =>
            HttpServerResponse.text(xml, {
              contentType: "application/xml; charset=utf-8",
              headers,
            }),
          ),
        ),
      );
  }),
);
