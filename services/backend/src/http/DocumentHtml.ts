import {
  type Document,
  type DocumentNode,
  type Mark,
  MediaUrl,
  SafeHref,
} from "@unhalteproblem.de/api";
import { escapeHtml } from "@unhalteproblem.de/seo";
import { Schema } from "effect";

// The stored document was validated when it was saved, and is decoded with
// the `Document` schema when it is read. This HTML is served from the site's
// own origin, so what could become markup is checked once more here: links
// and image sources must be a `SafeHref` or a `MediaUrl` (others are
// dropped), numbers are coerced, and all text is escaped.
const isSafeHref = Schema.is(SafeHref);
const isMediaUrl = Schema.is(MediaUrl);

const markTag = {
  bold: "strong",
  italic: "em",
  strike: "s",
  underline: "u",
  code: "code",
  highlight: "mark",
  subscript: "sub",
  superscript: "sup",
} as const;

const wrap = (html: string, mark: Mark): string => {
  if (mark.type !== "link") {
    const tag = markTag[mark.type];
    return `<${tag}>${html}</${tag}>`;
  }
  const { href } = mark.attrs;
  if (!isSafeHref(href)) return html;
  // `rel` is fixed, whatever the document says.
  return `<a href="${escapeHtml(href)}" rel="noopener">${html}</a>`;
};

const children = (nodes: ReadonlyArray<DocumentNode> | undefined): string =>
  (nodes ?? []).map(node).join("");

const node = (current: DocumentNode): string => {
  switch (current.type) {
    case "text":
      return (current.marks ?? []).reduce(wrap, escapeHtml(current.text));
    case "hardBreak":
      return "<br>";
    case "horizontalRule":
      return "<hr>";
    case "image": {
      const { src, alt } = current.attrs;
      if (!isMediaUrl(src)) return "";
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt ?? "")}" loading="lazy">`;
    }
    case "paragraph":
      return `<p>${children(current.content)}</p>`;
    case "heading": {
      // The page's own title is the h1.
      const level = Math.min(
        Math.max(Math.trunc(Number(current.attrs.level)) + 1, 2),
        6,
      );
      return `<h${level}>${children(current.content)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${children(current.content)}</blockquote>`;
    case "bulletList":
    case "taskList":
      return `<ul>${children(current.content)}</ul>`;
    case "orderedList": {
      const start = current.attrs?.start;
      return `<ol${start === undefined ? "" : ` start="${Math.trunc(Number(start))}"`}>${children(current.content)}</ol>`;
    }
    case "listItem":
      return `<li>${children(current.content)}</li>`;
    case "taskItem":
      return `<li>${current.attrs.checked ? "[x]" : "[ ]"} ${children(current.content)}</li>`;
    case "codeBlock": {
      const language = current.attrs?.language;
      const attribute =
        language === undefined || language === null
          ? ""
          : ` class="language-${escapeHtml(language)}"`;
      return `<pre><code${attribute}>${children(current.content)}</code></pre>`;
    }
  }
};

/**
 * The semantic HTML of a document, for the pages crawlers get: the same
 * text, headings, lists, code and images as the website shows, without its
 * styling. Everything is escaped.
 */
export const documentHtml = (document: Document): string =>
  children(document.content);
