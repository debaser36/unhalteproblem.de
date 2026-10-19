/**
 * Rich-text documents: the TipTap (ProseMirror) JSON of blog posts, as the
 * editor's `getJSON()` emits it and as the website renders it.
 *
 * The schema is a whitelist, and it is the XSS defence of the posts: the
 * website renders a document with TipTap, so only the node types, marks and
 * attributes below can ever reach the page. Unknown node types and marks
 * fail decoding; unknown attributes (and unknown keys of nodes and marks) are
 * dropped. Links only point to http(s), mailto, site-relative paths or
 * fragments (`SafeHref`), and images only show our own uploads (`MediaUrl`).
 *
 * Optional attributes accept `null`, because `getJSON()` emits every
 * attribute with its default, which is `null` for most of them. The nesting
 * of nodes is not checked as strictly as ProseMirror's content expressions
 * (TipTap normalizes a document when it loads it), but the root is always a
 * `doc`, leaves (`text`, `hardBreak`, `horizontalRule`, `image`) never have
 * `content`, and the tree is bounded (`DocumentLimits`).
 *
 * Every string is free of NUL and of unpaired surrogates: posts are stored
 * as `jsonb`, which rejects both.
 */
import { Schema } from "effect";

/** Bounds of a `Document`. */
export const DocumentLimits = {
  /** Deepest nesting of nodes below the `doc` (its blocks are level 1). */
  maxDepth: 24,
  /** Most nodes below the `doc`, at all levels together. */
  maxNodes: 20000,
  /** Longest `text` of one text node. */
  maxTextLength: 100000,
  /** Longest link target (`SafeHref`). */
  maxHrefLength: 2048,
  /** Longest `alt` and `title` of an image. */
  maxImageTextLength: 500,
} as const;

// Postgres `jsonb` rejects U+0000 and unpaired surrogates in strings, so a
// document containing them would pass validation and then fail in the
// database with a 500. In a `u` regex the class `[\ud800-\udfff]` matches
// only unpaired surrogates (a pair is one code point). The `u` flag is also
// required for `Schema.isPattern` to export the pattern to JSON Schema.
// oxlint-disable-next-line no-control-regex -- matching NUL is the point
const JSON_TEXT_PATTERN = /^[^\u0000\ud800-\udfff]*$/u;
const jsonText = Schema.isPattern(JSON_TEXT_PATTERN, {
  expected: "text without NUL characters or unpaired surrogates",
});

/** A string as stored in a document: no NUL, no unpaired surrogates. */
const DocumentString = Schema.String.check(jsonText);

/** An optional attribute: absent or `null` mean "not set". */
const optionalAttr = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(Schema.NullOr(schema));

// ---------------------------------------------------------------------------
// URLs

// Our own uploads only, as `mediaUrl(id)` builds them. Images from other
// hosts would let them see the readers' IP addresses.
const MEDIA_URL_PATTERN =
  /^\/api\/media\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

/**
 * The website's URL of an uploaded image, exactly `/api/media/<uuid>` (see
 * `mediaUrl`): the only image source a document may use.
 */
export const MediaUrl = Schema.String.check(
  Schema.isPattern(MEDIA_URL_PATTERN, {
    expected: "a media URL, /api/media/<uuid>",
  }),
).annotate({
  identifier: "MediaUrl",
  description:
    "URL of an uploaded image on this website, exactly `/api/media/<uuid>`.",
});
export type MediaUrl = typeof MediaUrl.Type;

const SAFE_PROTOCOLS: ReadonlySet<string> = new Set([
  "http:",
  "https:",
  "mailto:",
]);

// Any origin works as the base; it only tells whether a relative reference
// leaves it.
const RELATIVE_BASE = "https://relative.invalid";

const isSafeHref = (href: string): boolean => {
  if (
    href.startsWith("#") ||
    (href.startsWith("/") && !href.startsWith("//"))
  ) {
    // Resolved the way a browser resolves it: a site-relative reference
    // must stay on the site. That also rejects what browsers turn into a
    // protocol-relative URL, such as "/\evil.example" or "/\t/evil.example".
    return (
      URL.canParse(href, RELATIVE_BASE) &&
      new URL(href, RELATIVE_BASE).origin === RELATIVE_BASE
    );
  }
  // The parsed protocol, not a prefix of the string: the URL parser (like
  // the browser) lowercases it and strips whitespace and control characters,
  // so " JavaScript:" or "java\nscript:" are caught as well.
  return URL.canParse(href) && SAFE_PROTOCOLS.has(new URL(href).protocol);
};

/**
 * A link target that cannot run script or leave the expected schemes: an
 * absolute `http:`, `https:` or `mailto:` URL, a site-relative path
 * (`/blog/...`, not the protocol-relative `//host`) or a fragment (`#...`);
 * at most 2048 characters.
 */
export const SafeHref = DocumentString.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(DocumentLimits.maxHrefLength),
  Schema.makeFilter<string>(
    (href) =>
      isSafeHref(href) ||
      "an http(s) or mailto URL, a path starting with a single /, or a #fragment",
    {
      expected: "an http(s) or mailto URL, a site-relative path or a #fragment",
    },
  ),
).annotate({
  identifier: "SafeHref",
  description:
    "A link target: an absolute `http:`, `https:` or `mailto:` URL, a " +
    "site-relative path starting with a single `/`, or a `#fragment`; at " +
    "most 2048 characters.",
});
export type SafeHref = typeof SafeHref.Type;

// ---------------------------------------------------------------------------
// Marks

/** The marks without attributes. */
const SimpleMark = Schema.Struct({
  type: Schema.Literals([
    "bold",
    "italic",
    "strike",
    "underline",
    "code",
    "highlight",
    "subscript",
    "superscript",
  ]),
}).annotate({
  identifier: "SimpleMark",
  description: "A text mark without attributes.",
});

/** A link, as TipTap's Link extension emits it. */
const LinkMark = Schema.Struct({
  type: Schema.Literal("link"),
  attrs: Schema.Struct({
    href: SafeHref,
    target: optionalAttr(Schema.Literal("_blank")),
    rel: optionalAttr(DocumentString.check(Schema.isMaxLength(100))),
    // TipTap emits `class: null`; a class is never accepted, so documents
    // cannot pull in the site's styles.
    class: Schema.optionalKey(Schema.Null),
  }),
}).annotate({
  identifier: "LinkMark",
  description: "A link. `href` is a `SafeHref`.",
});

/** A text mark: one of the simple marks or a link. */
export const Mark = Schema.Union([SimpleMark, LinkMark]).annotate({
  identifier: "Mark",
  description:
    "A text mark: bold, italic, strike, underline, code, highlight, " +
    "subscript, superscript or link.",
});
export type Mark = typeof Mark.Type;

const Marks = Schema.optionalKey(Schema.Array(Mark));

// ---------------------------------------------------------------------------
// Nodes

const TextAlign = Schema.Literals(["left", "center", "right", "justify"]);

const ParagraphAttrs = Schema.Struct({ textAlign: optionalAttr(TextAlign) });
const HeadingAttrs = Schema.Struct({
  level: Schema.Literals([1, 2, 3, 4]),
  textAlign: optionalAttr(TextAlign),
});
const OrderedListAttrs = Schema.Struct({
  start: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10000 })),
  ),
  type: optionalAttr(DocumentString.check(Schema.isMaxLength(16))),
});
const TaskItemAttrs = Schema.Struct({ checked: Schema.Boolean });
const CodeBlockAttrs = Schema.Struct({
  language: optionalAttr(
    Schema.String.check(
      Schema.isPattern(/^[a-z0-9+#.-]{1,32}$/u, {
        expected: 'a language name such as "ts" or "c++"',
      }),
    ),
  ),
});
const ImageAttrs = Schema.Struct({
  src: MediaUrl,
  alt: optionalAttr(
    DocumentString.check(Schema.isMaxLength(DocumentLimits.maxImageTextLength)),
  ),
  title: optionalAttr(
    DocumentString.check(Schema.isMaxLength(DocumentLimits.maxImageTextLength)),
  ),
});

type Children = ReadonlyArray<DocumentNode>;

export interface ParagraphNode {
  readonly type: "paragraph";
  readonly attrs?: typeof ParagraphAttrs.Type;
  readonly content?: Children;
}
export interface HeadingNode {
  readonly type: "heading";
  readonly attrs: typeof HeadingAttrs.Type;
  readonly content?: Children;
}
export interface BlockquoteNode {
  readonly type: "blockquote";
  readonly content?: Children;
}
export interface BulletListNode {
  readonly type: "bulletList";
  readonly content?: Children;
}
export interface OrderedListNode {
  readonly type: "orderedList";
  readonly attrs?: typeof OrderedListAttrs.Type;
  readonly content?: Children;
}
export interface ListItemNode {
  readonly type: "listItem";
  readonly content?: Children;
}
export interface TaskListNode {
  readonly type: "taskList";
  readonly content?: Children;
}
export interface TaskItemNode {
  readonly type: "taskItem";
  readonly attrs: typeof TaskItemAttrs.Type;
  readonly content?: Children;
}
export interface CodeBlockNode {
  readonly type: "codeBlock";
  readonly attrs?: typeof CodeBlockAttrs.Type;
  readonly content?: Children;
}
export interface HorizontalRuleNode {
  readonly type: "horizontalRule";
  readonly content?: never;
}
export interface HardBreakNode {
  readonly type: "hardBreak";
  readonly marks?: ReadonlyArray<Mark>;
  readonly content?: never;
}
export interface ImageNode {
  readonly type: "image";
  readonly attrs: typeof ImageAttrs.Type;
  readonly content?: never;
}
export interface TextNode {
  readonly type: "text";
  readonly text: string;
  readonly marks?: ReadonlyArray<Mark>;
  readonly content?: never;
}

/** Any node below the `doc`. */
export type DocumentNode =
  | ParagraphNode
  | HeadingNode
  | BlockquoteNode
  | BulletListNode
  | OrderedListNode
  | ListItemNode
  | TaskListNode
  | TaskItemNode
  | CodeBlockNode
  | HorizontalRuleNode
  | HardBreakNode
  | ImageNode
  | TextNode;

const content = Schema.optionalKey(
  Schema.Array(Schema.suspend((): Schema.Codec<DocumentNode> => DocumentNode)),
);

// Present `content` on a leaf fails decoding instead of being dropped like
// other unknown keys, so a leaf never silently loses children.
const noContent = Schema.optionalKey(Schema.Never);

/** Defines a container node: `type`, optional `content`, and `fields`. */
const container = <
  const Type extends string,
  Fields extends Schema.Struct.Fields,
>(
  type: Type,
  identifier: string,
  fields: Fields,
) =>
  Schema.Struct({ type: Schema.Literal(type), ...fields, content }).annotate({
    identifier,
  });

/** Defines a leaf node: `type`, no `content`, and `fields`. */
const leaf = <const Type extends string, Fields extends Schema.Struct.Fields>(
  type: Type,
  identifier: string,
  fields: Fields,
) =>
  Schema.Struct({
    type: Schema.Literal(type),
    ...fields,
    content: noContent,
  }).annotate({ identifier });

/**
 * A node below the `doc`: one of the whitelisted TipTap node types with its
 * attributes. `text`, `hardBreak`, `horizontalRule` and `image` are leaves
 * without `content`.
 */
export const DocumentNode: Schema.Codec<DocumentNode> = Schema.Union([
  container("paragraph", "ParagraphNode", {
    attrs: Schema.optionalKey(ParagraphAttrs),
  }),
  container("heading", "HeadingNode", { attrs: HeadingAttrs }),
  container("blockquote", "BlockquoteNode", {}),
  container("bulletList", "BulletListNode", {}),
  container("orderedList", "OrderedListNode", {
    attrs: Schema.optionalKey(OrderedListAttrs),
  }),
  container("listItem", "ListItemNode", {}),
  container("taskList", "TaskListNode", {}),
  container("taskItem", "TaskItemNode", { attrs: TaskItemAttrs }),
  container("codeBlock", "CodeBlockNode", {
    attrs: Schema.optionalKey(CodeBlockAttrs),
  }),
  leaf("horizontalRule", "HorizontalRuleNode", {}),
  leaf("hardBreak", "HardBreakNode", { marks: Marks }),
  leaf("image", "ImageNode", { attrs: ImageAttrs }),
  leaf("text", "TextNode", {
    text: DocumentString.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(DocumentLimits.maxTextLength),
    ),
    marks: Marks,
  }),
]).annotate({
  identifier: "DocumentNode",
  description:
    "A node of a TipTap document below the `doc`. Leaves (`text`, " +
    "`hardBreak`, `horizontalRule`, `image`) have no `content`.",
});

/** Depth (deepest level below the `doc`) and number of nodes of a tree. */
const measure = (
  root: Children,
): { readonly depth: number; readonly nodes: number } => {
  let depth = 0;
  let nodes = 0;
  // Iterative, so a deep tree cannot overflow the stack here.
  const pending: Array<readonly [Children, number]> = [[root, 1]];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [children, level] = next;
    if (children.length === 0) continue;
    nodes += children.length;
    depth = Math.max(depth, level);
    for (const child of children) {
      if (child.content !== undefined) pending.push([child.content, level + 1]);
    }
  }
  return { depth, nodes };
};

/**
 * A rich-text document (TipTap JSON): a `doc` whose `content` holds the
 * blocks. At most 24 levels of nodes below the `doc` and 20000 nodes in
 * total (`DocumentLimits`).
 */
export const Document = Schema.Struct({
  type: Schema.Literal("doc"),
  content: Schema.Array(DocumentNode),
})
  .check(
    Schema.makeFilter(
      ({ content }) => {
        const { depth, nodes } = measure(content);
        if (depth > DocumentLimits.maxDepth) {
          return `nested at most ${DocumentLimits.maxDepth} levels deep`;
        }
        if (nodes > DocumentLimits.maxNodes) {
          return `at most ${DocumentLimits.maxNodes} nodes`;
        }
        return true;
      },
      {
        expected:
          `a document at most ${DocumentLimits.maxDepth} levels deep with ` +
          `at most ${DocumentLimits.maxNodes} nodes`,
      },
    ),
  )
  .annotate({
    identifier: "Document",
    description:
      "A rich-text document as TipTap JSON: a `doc` node whose `content` " +
      "holds the blocks. Only whitelisted node types, marks and attributes " +
      "are accepted; unknown attributes are dropped. At most 24 levels of " +
      "nodes below the `doc` and 20000 nodes in total.",
  });
export type Document = typeof Document.Type;

/** A document with one empty paragraph, like a fresh TipTap editor's. */
export const emptyDocument: Document = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const BLOCK_TYPES: ReadonlySet<DocumentNode["type"]> = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "horizontalRule",
  "image",
]);

/**
 * The plain text of a document, for search, summaries and reading time:
 * the text of every text node, with a line break after each block and for
 * each `hardBreak`; no empty lines, trimmed. Images and marks contribute
 * nothing.
 */
export const documentText = (document: Document): string => {
  const parts: Array<string> = [];
  const visit = (nodes: Children): void => {
    for (const node of nodes) {
      if (node.type === "text") {
        parts.push(node.text);
      } else if (node.type === "hardBreak") {
        parts.push("\n");
      } else {
        if (node.content !== undefined) visit(node.content);
        if (BLOCK_TYPES.has(node.type)) parts.push("\n");
      }
    }
  };
  visit(document.content);
  return parts
    .join("")
    .replace(/[ \t]*\n\s*/gu, "\n")
    .trim();
};
