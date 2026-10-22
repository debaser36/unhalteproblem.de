import type { SeoTags } from "./Tags.ts";

/** Escapes text for HTML content and for quoted attribute values. */
export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const metaTag = ({ attribute, key, content }: SeoTags["meta"][number]) =>
  `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(content)}">`;

/**
 * A complete HTML page for crawlers and link previews: the head from `tags`
 * and `body`, which the caller has already escaped. The JSON-LD strings come
 * from `buildSeo`, which makes them safe inside a `<script>`.
 */
export const renderDocument = (tags: SeoTags, body: string): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(tags.title)}</title>`,
    `<link rel="canonical" href="${escapeHtml(tags.canonical)}">`,
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    ...tags.meta.map(metaTag),
    ...tags.jsonLd.map(
      (json) => `<script type="application/ld+json">${json}</script>`,
    ),
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
