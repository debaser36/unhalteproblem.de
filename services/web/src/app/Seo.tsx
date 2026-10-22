import { buildSeo, type SeoInput, type SeoTags } from "@unhalteproblem.de/seo";
import { useEffect } from "react";
import { useLocation } from "react-router";
import { site } from "#app/site.ts";

/** Marks the head elements this component owns; `index.html` sets it too. */
const owned = "data-seo";

function apply(tags: SeoTags) {
  const head = document.head;
  document.title = tags.title;
  for (const old of head.querySelectorAll(`[${owned}]`)) old.remove();

  const mark = <T extends HTMLElement>(element: T): T => {
    element.setAttribute(owned, "");
    head.append(element);
    return element;
  };

  const canonical = mark(document.createElement("link"));
  canonical.rel = "canonical";
  canonical.href = tags.canonical;

  for (const { attribute, key, content } of tags.meta) {
    const meta = mark(document.createElement("meta"));
    meta.setAttribute(attribute, key);
    meta.content = content;
  }

  for (const json of tags.jsonLd) {
    const script = mark(document.createElement("script"));
    script.type = "application/ld+json";
    script.textContent = json;
  }
}

/**
 * Sets the document title, description, canonical link, Open Graph and
 * Twitter tags and structured data for the page that renders it. Every
 * routed page renders exactly one, also the private ones (`noindex`): the
 * next page replaces what this one wrote.
 */
export function Seo(props: SeoInput) {
  const serialized = JSON.stringify(buildSeo(site, props));
  useEffect(() => {
    apply(JSON.parse(serialized) as SeoTags);
  }, [serialized]);
  return null;
}

/**
 * For pages that are not for search engines: the account, the admin panel,
 * editors, forms and the 404 page. Search results skip them and follow
 * none of their links.
 */
export function NoIndex({ title }: { readonly title: string }) {
  const { pathname } = useLocation();
  return <Seo title={title} path={pathname} noindex />;
}
