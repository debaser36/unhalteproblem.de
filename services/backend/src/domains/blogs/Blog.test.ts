import { assert, describe, it } from "@effect/vitest";
import { type Document, documentText } from "@unhalteproblem.de/api";
import { DateTime, Option } from "effect";
import { UserId } from "#domains/users/User";
import {
  BlogId,
  isStale,
  PostId,
  PostRow,
  publish,
  readingMinutes,
} from "./Blog.ts";

// How the repository counts words (in SQL): whitespace-separated runs of text.
const wordsIn = (document: Document) =>
  documentText(document).split(/\s+/u).filter(Boolean).length;

const t0 = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
const t1 = DateTime.makeUnsafe("2026-02-01T00:00:00Z");
const author = UserId.make("8f3c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b");

const words = (count: number) =>
  Array.from({ length: count }, (_, index) => `w${index}`).join(" ");

const paragraphs = (...texts: ReadonlyArray<string>): Document => ({
  type: "doc",
  content: texts.map((text) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  })),
});

const draft = PostRow.make({
  id: PostId.make("1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d"),
  blogId: BlogId.make("2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e"),
  slug: "hello",
  title: "Hello",
  summary: "",
  tags: ["rust"],
  coverMediaId: Option.none(),
  content: paragraphs("Hello"),
  status: "draft",
  publishedAt: Option.none(),
  authorId: Option.some(author),
  updatedBy: Option.some(author),
  createdAt: t0,
  updatedAt: t0,
  version: 3,
});

describe("readingMinutes", () => {
  it.for([
    [0, 0],
    [1, 1],
    [109, 1],
    [220, 1],
    [329, 1],
    [330, 2],
    [440, 2],
    [1100, 5],
  ] as const)("%i words take %i minutes", ([count, minutes]) => {
    assert.strictEqual(
      readingMinutes(
        wordsIn(paragraphs(...(count === 0 ? [] : [words(count)]))),
      ),
      minutes,
    );
  });

  it("counts the words of every block and across line breaks", () => {
    const document: Document = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: words(100) }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: words(100) },
            { type: "hardBreak" },
            { type: "text", text: words(130) },
          ],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [paragraphs(words(110)).content[0]!] },
          ],
        },
      ],
    };
    // 440 words.
    assert.strictEqual(readingMinutes(wordsIn(document)), 2);
  });

  it("a document without text takes no time", () => {
    assert.strictEqual(
      readingMinutes(
        wordsIn({ type: "doc", content: [{ type: "paragraph" }] }),
      ),
      0,
    );
    assert.strictEqual(readingMinutes(wordsIn(paragraphs("   "))), 0);
    assert.strictEqual(
      readingMinutes(
        wordsIn({ type: "doc", content: [{ type: "horizontalRule" }] }),
      ),
      0,
    );
  });
});

describe("publish", () => {
  it("a first publication sets the time", () => {
    const published = publish(draft, t1);
    assert.strictEqual(published.status, "published");
    assert.deepStrictEqual(published.publishedAt, Option.some(t1));
    // Everything else stays; saving it is the command's business.
    assert.deepStrictEqual(
      { ...published, status: draft.status, publishedAt: draft.publishedAt },
      { ...draft },
    );
  });

  it("republishing keeps the first publication time", () => {
    const unpublished = PostRow.make({
      ...draft,
      publishedAt: Option.some(t0),
    });
    assert.deepStrictEqual(
      publish(unpublished, t1).publishedAt,
      Option.some(t0),
    );
    const published = publish(draft, t0);
    assert.deepStrictEqual(publish(published, t1).publishedAt, Option.some(t0));
  });
});

describe("isStale", () => {
  it("only an edit from the current version is fresh", () => {
    assert.isFalse(isStale(draft, 3));
    assert.isTrue(isStale(draft, 2));
    assert.isTrue(isStale(draft, 4));
  });
});
