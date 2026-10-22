/**
 * What a page tells search engines and link previews about itself. Pure:
 * `buildSeo` turns a description of the page into the tags, and
 * `#app/Seo.tsx` puts them into the document head.
 */

export interface SeoSite {
  readonly origin: string;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  readonly image: string;
}

export interface SeoArticle {
  /** ISO 8601 date-times. */
  readonly publishedAt: string;
  readonly updatedAt: string;
  readonly author: string | null;
  readonly tags: ReadonlyArray<string>;
}

export interface SeoInput {
  /** Without the site name; `undefined` for the home page. */
  readonly title?: string;
  readonly description?: string;
  /** The page's path, e.g. `/blog/notes`. Query and hash are not part of it. */
  readonly path: string;
  /** A path on the site or an absolute URL. */
  readonly image?: string | undefined;
  readonly article?: SeoArticle;
  /** Keep the page out of search results (private and utility pages). */
  readonly noindex?: boolean;
  /**
   * With `noindex`: still follow the page's links, for list pages whose
   * entries should be found (page 2 of a list). Private pages do not.
   */
  readonly follow?: boolean;
  /** Structured data; each entry becomes one JSON-LD script. */
  readonly jsonLd?: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

/** A `<meta>` tag, identified by its `name` or `property` attribute. */
export interface SeoMeta {
  readonly attribute: "name" | "property";
  readonly key: string;
  readonly content: string;
}

export interface SeoTags {
  readonly title: string;
  readonly canonical: string;
  readonly meta: ReadonlyArray<SeoMeta>;
  /** Serialized so that they are safe inside a `<script>` element. */
  readonly jsonLd: ReadonlyArray<string>;
}

/** Search engines cut descriptions at about this many characters. */
export const maxDescriptionLength = 160;

/** Collapses whitespace and cuts at a word boundary with an ellipsis. */
export const toDescription = (
  text: string,
  max: number = maxDescriptionLength,
): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  // A word boundary near the end, otherwise a hard cut.
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
};

/** Absolute URL of a path on the site; absolute URLs stay as they are. */
export const absoluteUrl = (origin: string, pathOrUrl: string): string =>
  /^https?:\/\//.test(pathOrUrl)
    ? pathOrUrl
    : `${origin}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;

/** The canonical URL of a path: no query, no hash, no trailing slash. */
export const canonicalUrl = (origin: string, path: string): string => {
  const clean = path.split(/[?#]/)[0] ?? "/";
  const trimmed = clean.length > 1 ? clean.replace(/\/+$/, "") : clean;
  return `${origin}${trimmed}`;
};

/**
 * JSON for a `<script type="application/ld+json">`. Posts and projects are
 * written by users, so `<` is escaped: a title containing `</script>` must
 * not end the element.
 */
export const serializeJsonLd = (data: Readonly<Record<string, unknown>>) =>
  JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

export function buildSeo(site: SeoSite, input: SeoInput): SeoTags {
  const title =
    input.title === undefined || input.title === ""
      ? `${site.name} — ${site.tagline}`
      : `${input.title} · ${site.name}`;
  const description = toDescription(input.description ?? site.description);
  const canonical = canonicalUrl(site.origin, input.path);
  const image = absoluteUrl(site.origin, input.image ?? site.image);
  const ogTitle = input.title === undefined ? site.name : input.title;

  const meta: Array<SeoMeta> = [
    { attribute: "name", key: "description", content: description },
    {
      attribute: "name",
      key: "robots",
      content: input.noindex
        ? input.follow
          ? "noindex, follow"
          : "noindex, nofollow"
        : "index, follow, max-image-preview:large",
    },
    { attribute: "property", key: "og:site_name", content: site.name },
    { attribute: "property", key: "og:locale", content: "en_US" },
    {
      attribute: "property",
      key: "og:type",
      content: input.article === undefined ? "website" : "article",
    },
    { attribute: "property", key: "og:title", content: ogTitle },
    { attribute: "property", key: "og:description", content: description },
    { attribute: "property", key: "og:url", content: canonical },
    { attribute: "property", key: "og:image", content: image },
    { attribute: "name", key: "twitter:card", content: "summary_large_image" },
    { attribute: "name", key: "twitter:title", content: ogTitle },
    { attribute: "name", key: "twitter:description", content: description },
    { attribute: "name", key: "twitter:image", content: image },
  ];

  if (input.article !== undefined) {
    const { publishedAt, updatedAt, author, tags } = input.article;
    meta.push(
      {
        attribute: "property",
        key: "article:published_time",
        content: publishedAt,
      },
      {
        attribute: "property",
        key: "article:modified_time",
        content: updatedAt,
      },
    );
    if (author !== null) {
      meta.push({ attribute: "name", key: "author", content: author });
    }
    for (const tag of tags) {
      meta.push({ attribute: "property", key: "article:tag", content: tag });
    }
  }

  return {
    title,
    canonical,
    meta,
    jsonLd: (input.jsonLd ?? []).map(serializeJsonLd),
  };
}

const schema = "https://schema.org";

/** A `BreadcrumbList`: the trail from the home page to the current one. */
export const breadcrumbsJsonLd = (
  origin: string,
  trail: ReadonlyArray<{ readonly name: string; readonly path: string }>,
) => ({
  "@context": schema,
  "@type": "BreadcrumbList",
  itemListElement: trail.map(({ name, path }, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name,
    item: canonicalUrl(origin, path),
  })),
});

/** A `BlogPosting`, as Google reads it for article results. */
export const blogPostingJsonLd = (
  origin: string,
  post: {
    readonly path: string;
    readonly title: string;
    readonly description: string;
    readonly image: string | undefined;
    readonly publishedAt: string;
    readonly updatedAt: string;
    readonly author: string | null;
    readonly tags: ReadonlyArray<string>;
    readonly section: string;
  },
) => ({
  "@context": schema,
  "@type": "BlogPosting",
  headline: post.title,
  description: post.description,
  mainEntityOfPage: canonicalUrl(origin, post.path),
  datePublished: post.publishedAt,
  dateModified: post.updatedAt,
  articleSection: post.section,
  ...(post.image === undefined
    ? {}
    : { image: absoluteUrl(origin, post.image) }),
  ...(post.author === null
    ? {}
    : { author: { "@type": "Person", name: post.author } }),
  ...(post.tags.length === 0 ? {} : { keywords: post.tags.join(", ") }),
});

/** A project: source code when it has a repository, otherwise a work. */
export const projectJsonLd = (
  origin: string,
  project: {
    readonly path: string;
    readonly title: string;
    readonly description: string;
    readonly image: string | undefined;
    readonly updatedAt: string;
    readonly repoUrl: string | null;
    readonly tags: ReadonlyArray<string>;
  },
) => ({
  "@context": schema,
  "@type": project.repoUrl === null ? "CreativeWork" : "SoftwareSourceCode",
  name: project.title,
  description: project.description,
  url: canonicalUrl(origin, project.path),
  dateModified: project.updatedAt,
  ...(project.repoUrl === null ? {} : { codeRepository: project.repoUrl }),
  ...(project.image === undefined
    ? {}
    : { image: absoluteUrl(origin, project.image) }),
  ...(project.tags.length === 0 ? {} : { keywords: project.tags.join(", ") }),
});
