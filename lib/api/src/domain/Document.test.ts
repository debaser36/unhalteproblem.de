import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import {
  Document,
  DocumentLimits,
  documentText,
  emptyDocument,
  MediaUrl,
  SafeHref,
} from "./Document.ts";

const imageId = "3f0c6a8e-2b1d-4c5e-9f7a-1b2c3d4e5f60";

// As TipTap v3's `editor.getJSON()` emits it: attributes with their `null`
// defaults, link marks with `target`, `rel` and `class`.
const tiptapDocument = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { textAlign: null, level: 1 },
      content: [{ type: "text", text: "Hello, types" }],
    },
    {
      type: "paragraph",
      attrs: { textAlign: "justify" },
      content: [
        { type: "text", text: "Some " },
        { type: "text", marks: [{ type: "bold" }], text: "bold" },
        { type: "text", text: " and a " },
        {
          type: "text",
          marks: [
            {
              type: "link",
              attrs: {
                href: "https://example.org/a?b=c#d",
                target: "_blank",
                rel: "noopener noreferrer nofollow",
                class: null,
              },
            },
            { type: "italic" },
          ],
          text: "link",
        },
        { type: "hardBreak" },
        {
          type: "text",
          marks: [
            {
              type: "link",
              attrs: { href: "/blogs/rust-notes", target: null, rel: null },
            },
          ],
          text: "inside",
        },
        { type: "text", text: ", " },
        {
          type: "text",
          marks: [{ type: "link", attrs: { href: "#intro" } }],
          text: "anchor",
        },
        { type: "text", text: " and " },
        {
          type: "text",
          marks: [{ type: "link", attrs: { href: "mailto:ada@example.org" } }],
          text: "mail",
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              attrs: { textAlign: null },
              content: [
                { type: "text", marks: [{ type: "code" }], text: "x: T" },
              ],
            },
            {
              type: "orderedList",
              attrs: { start: 1, type: null },
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "nested" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "done" }] },
          ],
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [{ type: "text", text: "const x: number = 1;\nx + 1;" }],
    },
    { type: "codeBlock", attrs: { language: null } },
    {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [{ type: "highlight" }, { type: "underline" }],
              text: "quoted",
            },
          ],
        },
      ],
    },
    { type: "horizontalRule" },
    {
      type: "image",
      attrs: {
        src: `/api/media/${imageId}`,
        alt: "A diagram",
        title: null,
        width: null,
        height: null,
      },
    },
    { type: "paragraph", attrs: { textAlign: null } },
  ],
};

const decode = Schema.decodeUnknownExit(Document);

/** `tiptapDocument` with `node` as the only block. */
const withBlock = (node: unknown) => ({ type: "doc", content: [node] });

/** A paragraph with one text node marked with `mark`. */
const markedText = (mark: unknown) =>
  withBlock({
    type: "paragraph",
    content: [{ type: "text", text: "x", marks: [mark] }],
  });

const link = (href: unknown) => markedText({ type: "link", attrs: { href } });

/** `levels` nested blockquotes around one paragraph. */
const nested = (levels: number) => {
  let node: unknown = {
    type: "paragraph",
    content: [{ type: "text", text: "deep" }],
  };
  for (let i = 0; i < levels; i++) {
    node = { type: "blockquote", content: [node] };
  }
  return withBlock(node);
};

describe("Document", () => {
  it("accepts a realistic TipTap document and round-trips it", () => {
    const exit = decode(tiptapDocument);
    assert.isTrue(Exit.isSuccess(exit));
    if (Exit.isFailure(exit)) return;
    const encoded = Schema.encodeSync(Document)(exit.value);
    // Unknown attributes (the image's width and height) are dropped,
    // everything else survives unchanged.
    const image = encoded.content.find((node) => node.type === "image");
    assert.deepStrictEqual(image, {
      type: "image",
      attrs: { src: `/api/media/${imageId}`, alt: "A diagram", title: null },
    });
    const { content: _, ...rest } = encoded;
    assert.deepStrictEqual(rest, { type: "doc" });
    assert.deepStrictEqual<ReadonlyArray<unknown>>(
      encoded.content.filter((node) => node.type !== "image"),
      tiptapDocument.content.filter((node) => node.type !== "image"),
    );
  });

  it("accepts the empty document", () => {
    assert.deepStrictEqual(decode(emptyDocument), Exit.succeed(emptyDocument));
  });

  it("drops unknown attributes and keys", () => {
    const exit = decode(
      withBlock({
        type: "paragraph",
        attrs: { textAlign: "center", style: "color: red", onclick: "x()" },
        id: "p1",
        content: [{ type: "text", text: "x" }],
      }),
    );
    assert.deepStrictEqual(
      exit,
      Exit.succeed({
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "center" },
            content: [{ type: "text", text: "x" }],
          },
        ],
      }),
    );
  });

  it.each([
    ["a javascript: link", link("javascript:alert(1)")],
    ["an uppercase JavaScript: link", link("JavaScript:alert(1)")],
    ["a javascript: link with whitespace", link(" java\nscript:alert(1)")],
    ["a data: link", link("data:text/html,<script>alert(1)</script>")],
    ["a protocol-relative link", link("//evil.example")],
    ["a backslash link", link("/\\evil.example")],
    ["a tab-split link", link("/\t/evil.example")],
    ["a relative link without a slash", link("evil.example")],
    ["an empty link", link("")],
    ["a too long link", link(`/${"a".repeat(DocumentLimits.maxHrefLength)}`)],
    [
      "a link with a class",
      markedText({ type: "link", attrs: { href: "/", class: "btn" } }),
    ],
    [
      "a link with another target",
      markedText({ type: "link", attrs: { href: "/", target: "_top" } }),
    ],
    [
      "an external image",
      withBlock({
        type: "image",
        attrs: { src: "https://evil.example/pixel.gif" },
      }),
    ],
    [
      "a protocol-relative image",
      withBlock({ type: "image", attrs: { src: `//evil.example/${imageId}` } }),
    ],
    [
      "an image path that is not a media id",
      withBlock({ type: "image", attrs: { src: "/api/media/../admin" } }),
    ],
    ["an image without src", withBlock({ type: "image", attrs: {} })],
    [
      "an unknown node type",
      withBlock({ type: "iframe", attrs: { src: "https://evil.example" } }),
    ],
    ["a nested doc", withBlock({ type: "doc", content: [] })],
    ["an unknown mark", markedText({ type: "script" })],
    [
      "a text node with content",
      withBlock({
        type: "paragraph",
        content: [
          { type: "text", text: "x", content: [{ type: "text", text: "y" }] },
        ],
      }),
    ],
    [
      "a hard break with content",
      withBlock({
        type: "paragraph",
        content: [{ type: "hardBreak", content: [] }],
      }),
    ],
    [
      "an image with content",
      withBlock({
        type: "image",
        attrs: { src: `/api/media/${imageId}` },
        content: [],
      }),
    ],
    [
      "an empty text node",
      withBlock({ type: "paragraph", content: [{ type: "text", text: "" }] }),
    ],
    [
      "text with NUL",
      withBlock({
        type: "paragraph",
        content: [{ type: "text", text: "a\u0000b" }],
      }),
    ],
    [
      "text with an unpaired surrogate",
      withBlock({
        type: "paragraph",
        content: [{ type: "text", text: "a\ud800b" }],
      }),
    ],
    [
      "a heading of level 5",
      withBlock({ type: "heading", attrs: { level: 5 } }),
    ],
    ["a heading without attrs", withBlock({ type: "heading" })],
    [
      "an unknown alignment",
      withBlock({ type: "paragraph", attrs: { textAlign: "start" } }),
    ],
    [
      "a code language with markup",
      withBlock({ type: "codeBlock", attrs: { language: '"><script>' } }),
    ],
    ["a task item without checked", withBlock({ type: "taskItem" })],
    ["a root that is not a doc", { type: "paragraph", content: [] }],
    ["a doc without content", { type: "doc" }],
    [
      "a tree one level deeper than the limit",
      nested(DocumentLimits.maxDepth - 1),
    ],
  ])("rejects %s", (_, document) => {
    assert.isTrue(Exit.isFailure(decode(document)));
  });

  it("accepts a tree exactly at the depth limit", () => {
    // The outermost blockquote is level 1, the text level maxDepth.
    assert.isTrue(Exit.isSuccess(decode(nested(DocumentLimits.maxDepth - 2))));
  });

  it("rejects a document with too many nodes", () => {
    const paragraphs = Array.from(
      { length: DocumentLimits.maxNodes / 2 },
      () => ({ type: "paragraph", content: [{ type: "text", text: "x" }] }),
    );
    assert.isTrue(Exit.isSuccess(decode({ type: "doc", content: paragraphs })));
    assert.isTrue(
      Exit.isFailure(
        decode({
          type: "doc",
          content: [...paragraphs, { type: "paragraph" }],
        }),
      ),
    );
  });

  it("exports a recursive JSON Schema", () => {
    const { schema, definitions } = Schema.toJsonSchemaDocument(Document);
    assert.deepStrictEqual(schema, { $ref: "#/$defs/Document" });
    assert.containsAllKeys(definitions, [
      "Document",
      "DocumentNode",
      "ParagraphNode",
      "TextNode",
      "Mark",
      "LinkMark",
      "SafeHref",
      "MediaUrl",
    ]);
    // Container nodes refer back to `DocumentNode`.
    const paragraph = definitions["ParagraphNode"] as {
      readonly properties: Record<string, unknown>;
    };
    assert.deepStrictEqual(paragraph.properties["content"], {
      type: "array",
      items: { $ref: "#/$defs/DocumentNode" },
    });
  });
});

describe("SafeHref and MediaUrl", () => {
  it.each([
    "https://example.org",
    "http://example.org/a",
    "mailto:ada@example.org",
    "/",
    "/blogs/rust-notes?x=1#y",
    "#section-2",
  ])("SafeHref accepts %s", (href) => {
    assert.deepStrictEqual(
      Schema.decodeUnknownExit(SafeHref)(href),
      Exit.succeed(href),
    );
  });

  it.each([
    "ftp://example.org",
    "vbscript:msgbox(1)",
    "//evil.example",
    "/\\evil.example",
    "relative/path",
  ])("SafeHref rejects %s", (href) => {
    assert.isTrue(Exit.isFailure(Schema.decodeUnknownExit(SafeHref)(href)));
  });

  it("MediaUrl accepts only /api/media/<uuid>", () => {
    const decodeUrl = Schema.decodeUnknownExit(MediaUrl);
    assert.isTrue(Exit.isSuccess(decodeUrl(`/api/media/${imageId}`)));
    for (const bad of [
      `/api/media/${imageId}/`,
      `/api/media/${imageId}?x`,
      `https://unhalteproblem.de/api/media/${imageId}`,
      `/media/${imageId}`,
      "/api/media/not-a-uuid",
    ]) {
      assert.isTrue(Exit.isFailure(decodeUrl(bad)), bad);
    }
  });
});

describe("documentText", () => {
  it("extracts the text with a line per block", () => {
    const document = Schema.decodeUnknownSync(Document)(tiptapDocument);
    assert.strictEqual(
      documentText(document),
      [
        "Hello, types",
        "Some bold and a link",
        "inside, anchor and mail",
        "x: T",
        "nested",
        "done",
        "const x: number = 1;",
        "x + 1;",
        "quoted",
      ].join("\n"),
    );
  });

  it("is empty for the empty document", () => {
    assert.strictEqual(documentText(emptyDocument), "");
  });
});
