import { BlogSlug, PostSlug } from "#domain/Blog";
import { ProjectSlug } from "#domain/Project";
import { SeoBlogQuery, SeoLimits, SeoPage } from "#domain/Seo";
import { BlogNotFound } from "#errors/BlogNotFound";
import { PostNotFound } from "#errors/PostNotFound";
import { ProjectNotFound } from "#errors/ProjectNotFound";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

// Documents the bodies only: the handlers return the responses themselves,
// with their own headers (see `responseHeaders`).
const html = (description: string) =>
  Schema.String.pipe(
    HttpApiSchema.asText({ contentType: "text/html" }),
  ).annotate({ description });

// Shared by the HTML pages and the sitemap.
const responseHeaders =
  "The response carries `Content-Security-Policy: default-src 'none'; " +
  "img-src 'self'; style-src 'unsafe-inline'; sandbox`, " +
  "`X-Content-Type-Options: nosniff` and `Cache-Control: public, " +
  "max-age=300`.";

// Shared by the HTML pages.
const pageDescription =
  "Public. Returns a server-rendered HTML page for crawlers and link-preview " +
  "bots; the website itself is a single-page app. The page has the same " +
  "text as the SPA page, plus schema.org JSON-LD. It is built from " +
  "published content only. " +
  responseHeaders +
  " The reverse proxy routes crawler requests for the website's pages here.";

/**
 * Server-rendered HTML pages and the sitemap, for crawlers and link-preview
 * bots. The website is a SPA, so these pages are what a crawler sees.
 *
 * Public on purpose (no `Authentication`): crawlers send no credentials, and
 * the pages only show content that is public anyway (published posts and
 * projects). Every endpoint is a GET.
 */
export class SeoGroup extends HttpApiGroup.make("seo")
  .add(
    HttpApiEndpoint.get("renderPage", "/seo/pages/:page", {
      params: { page: SeoPage },
      success: html("The HTML page."),
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Render a fixed page",
        description:
          pageDescription +
          " Renders one of the fixed pages (`SeoPage`: home, about, " +
          "contact, blog, projects); an unknown page is rejected with 400.",
      }),
    ),
    HttpApiEndpoint.get("renderBlog", "/seo/blogs/:blog", {
      params: { blog: BlogSlug },
      query: SeoBlogQuery,
      success: html("The HTML page of the subblog."),
      error: BlogNotFound,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Render a subblog",
        description:
          pageDescription +
          " Renders the subblog with its published posts, 50 per page; " +
          "`page` (1-based, 1 if absent) selects the page. A page beyond " +
          "the last answers 200 with an empty list. A `page` outside " +
          `1 to ${SeoLimits.maxPage} or a non-integer is rejected with 400 ` +
          "(later posts are reachable through the sitemap); 404 " +
          "`BlogNotFound` for an unknown slug.",
      }),
    ),
    HttpApiEndpoint.get("renderPost", "/seo/blogs/:blog/posts/:post", {
      params: { blog: BlogSlug, post: PostSlug },
      success: html("The HTML page of the post."),
      error: [BlogNotFound, PostNotFound],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Render a published post",
        description:
          pageDescription +
          " Renders the published post; drafts answer 404 like unknown " +
          "posts: `BlogNotFound` for an unknown subblog, `PostNotFound` " +
          "for an unknown or unpublished post.",
      }),
    ),
    HttpApiEndpoint.get("renderProject", "/seo/projects/:project", {
      params: { project: ProjectSlug },
      success: html("The HTML page of the project."),
      error: ProjectNotFound,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Render a published project",
        description:
          pageDescription +
          " Renders the published project; unpublished projects answer " +
          "404 `ProjectNotFound` like unknown slugs.",
      }),
    ),
    HttpApiEndpoint.get("getSitemap", "/sitemap.xml", {
      success: Schema.String.pipe(
        HttpApiSchema.asText({ contentType: "application/xml" }),
      ).annotate({ description: "The sitemap (sitemaps.org XML)." }),
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get the sitemap",
        description:
          "Public. Returns the sitemap (`application/xml`) of the fixed " +
          "pages and of all published blogs, posts and projects, built " +
          "from published content only. " +
          responseHeaders,
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "SEO",
      description:
        "Server-rendered HTML pages and the sitemap, for crawlers and " +
        "link-preview bots.",
    }),
  ) {}
