# SEO: crawler pages and the sitemap

The website is a single-page app: the server sends the same empty shell for
every URL, and the page's title, description, social tags and text appear
only once JavaScript has run. Crawlers that do not run it (link previews of
chat apps and social networks, many smaller crawlers) would see the same
generic page for every post. The `seo` API group gives them the real page.

| Endpoint                           | Answers                                                                |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `GET /seo/pages/:page`             | home, about, contact, blog or projects (`SeoPage`)                     |
| `GET /seo/blogs/:blog?page=N`      | a subblog with 50 published posts a page, newest first (page 1 to 100) |
| `GET /seo/blogs/:blog/posts/:post` | a published post with its whole text                                   |
| `GET /seo/projects/:project`       | a published project with its text                                      |
| `GET /sitemap.xml`                 | the fixed pages and all published blogs, posts and projects (50k max)  |

All of them are public and read only; drafts and unpublished projects answer
404 like unknown ones (`PostNotFound`, `ProjectNotFound`, `BlogNotFound`).
Code: `src/http/Seo.ts` (handlers), `src/http/DocumentHtml.ts` (a stored
document as HTML), tests in `src/http/Seo.test.ts`.

## Same tags as the website

The head of each page is built by `buildSeo` and the `postSeo`, `projectSeo`
and `blogSeo` helpers of `@unhalteproblem.de/seo` (`lib/seo`), the same code
the website uses to set its own head. Titles, descriptions, canonical URLs,
Open Graph and Twitter tags and the schema.org JSON-LD cannot drift apart.
The text of the fixed pages is their description (the SPA shows more).

## Routing (nginx)

`nix/backend-module.nix` (option `nginx.virtualHost`) does the routing:

1. A `map` on the user agent marks crawlers: `bot`, `crawl`, `spider`,
   `slurp` (Twitterbot, Slackbot, Googlebot, ...), `facebookexternalhit`,
   `WhatsApp/`, `Mastodon/`, `embedly`, `skypeuripreview`. Only fetchers: the
   in-app browsers of Twitter, LinkedIn or Slack put those app names in their
   user agents, and their users must get the SPA.
2. A second `map` turns a crawler's request for a public URL (`/`, `/about`,
   `/blog/<blog>`, `/blog/<blog>/<post>`, `/projects/<project>`, ...) into
   `/api/seo/...`. Other paths (editors, forms, unknown paths) stay with the
   SPA.
3. A server-level `rewrite ... last` applies it before a location is chosen,
   so the module needs no knowledge of how the host serves the SPA. People
   and other user agents are not affected.
   Of the query string only a numeric `page` is passed on (`/blog/<blog>?page=2`);
   everything else, tracking parameters included, is dropped.
4. `/api/seo/` and `/sitemap.xml` have their own rate limit
   (`unhalteproblem_seo`, 10 requests/s per address), because they read the
   database. `/api/seo/` answers `Vary: User-Agent`.

This is dynamic rendering: crawlers get the same text people see, in plain
HTML. Matching the user agent is a convenience, not a security boundary; the
pages are public and anyone who asks for them gets them.

The sitemap is built from the database at most every 5 minutes (it takes one
query per 500 posts). Past 50000 URLs it drops the oldest posts and logs a
warning; split it into a sitemap index then.

`/robots.txt` (a static file of the website) names the sitemap, blocks the
private paths and the rest of `/api/`, and allows `/api/media/` for images.

## Pages of a blog's list

A blog page lists 50 posts, with `Newer posts` and `Older posts` links
(`rel="prev"` and `rel="next"`) to `?page=N`, so crawlers can walk the whole
list. Page 2 and later are `noindex, follow` and name the blog itself as
their canonical URL: they exist so that the posts are found, not to appear in
search results. The website itself has no such pages (it loads more posts as
you scroll), so people who open one get the blog page.
The list is read with cursors, so page N reads the newest N x 50 posts and
keeps the last 50; the limit of 100 pages bounds that.

## Security

These pages are served from the site's own origin and show text written by
editors, so:

- Everything is escaped (`escapeHtml`); the JSON-LD is serialized with `<`
  escaped, so no title can end the script element.
- Links and image sources are checked again (`SafeHref`, `MediaUrl`) even
  though the document was validated when it was saved; unsafe ones are
  dropped. A link's `rel` is fixed to `noopener`, whatever the document says.
- The response carries `Content-Security-Policy: default-src 'none';
img-src 'self'; style-src 'unsafe-inline'; sandbox` and
  `X-Content-Type-Options: nosniff`, so even a page opened directly in a
  browser runs and loads nothing. `Cache-Control: public, max-age=300`: a
  post that is unpublished stays visible to crawlers for up to 5 minutes
  (and in the sitemap, for as long as it is cached).
- The pages never look at the session: the same response for everyone.

## Caveats

- The SPA's response and the crawler page share one URL and differ by user
  agent. `/api/seo/` answers `Vary: User-Agent`, but the SPA's response (served
  by the rest of the virtual host) does not. Behind a CDN that ignores `Vary`,
  anyone could make it cache the crawler page for everyone: make the CDN key
  its cache on the user agent or not cache these URLs.
- nginx's `add_header` in `/api/seo/` replaces the `add_header`s of the
  server block (HSTS and the like) for those responses; repeat them there if
  the host relies on them.
- A blog's list stops at page 100 (5000 posts); later posts are reachable for
  crawlers through the sitemap only.
