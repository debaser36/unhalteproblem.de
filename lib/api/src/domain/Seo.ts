import { Effect, Schema } from "effect";

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

/**
 * Limits of the crawler pages. A subblog page lists 50 posts, so 100 pages
 * cover 5000 posts; later posts are still reachable through the sitemap.
 */
export const SeoLimits = {
  /** Largest `page` accepted by `GET /seo/blogs/:blog`. */
  maxPage: 100,
} as const;

/**
 * Query of `GET /seo/blogs/:blog`: the 1-based page of the subblog's post
 * list. Decoding fills in page 1; in the generated client `page` is therefore
 * required (pass `1`).
 */
export const SeoBlogQuery = Schema.Struct({
  /** Page number, 1 to 100; 1 by default. */
  page: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: SeoLimits.maxPage }),
  )
    // Described on the key, before the default (see `PostPageQuery`).
    .annotateKey({
      description:
        "The 1-based page of the post list, an integer from 1 to " +
        `${SeoLimits.maxPage}; 1 if absent.`,
    })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed(1))),
}).annotate({
  identifier: "SeoBlogQuery",
  description: "The page of the post list on the crawler page of a subblog.",
});
export type SeoBlogQuery = typeof SeoBlogQuery.Type;
