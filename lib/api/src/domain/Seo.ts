import { Schema } from "effect";

/**
 * The fixed pages of the website that `GET /seo/pages/:page` renders for
 * crawlers: the home page, the about page, the contact page, the blog
 * overview and the project overview.
 */
export const SeoPage = Schema.Literals([
  "home",
  "about",
  "contact",
  "blog",
  "projects",
]).annotate({
  identifier: "SeoPage",
  description:
    "A fixed page of the website that is rendered as HTML for crawlers: " +
    "`home`, `about`, `contact`, `blog` (the blog overview) or `projects` " +
    "(the project overview).",
});
export type SeoPage = typeof SeoPage.Type;
