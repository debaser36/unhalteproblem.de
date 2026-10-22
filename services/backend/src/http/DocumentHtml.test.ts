import { type Document } from "@unhalteproblem.de/api";
import { describe, expect, it } from "vitest";
import { documentHtml } from "./DocumentHtml.ts";

const doc = (...content: Document["content"]): Document => ({
  type: "doc",
  content,
});
const text = (value: string, marks?: Array<unknown>) =>
  ({ type: "text", text: value, ...(marks ? { marks } : {}) }) as never;

describe("documentHtml", () => {
  it("renders blocks, marks and lists", () => {
    const html = documentHtml(
      doc(
        { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
        {
          type: "paragraph",
          content: [
            text("a "),
            text("b", [{ type: "bold" }, { type: "italic" }]),
            { type: "hardBreak" },
            text("c", [{ type: "code" }]),
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [text("x")] }],
            },
          ],
        },
        { type: "orderedList", attrs: { start: 3 }, content: [] },
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [text("a < b")],
        },
        { type: "horizontalRule" },
      ),
    );
    expect(html).toBe(
      "<h2>Title</h2>" +
        "<p>a <em><strong>b</strong></em><br><code>c</code></p>" +
        "<ul><li><p>x</p></li></ul>" +
        '<ol start="3"></ol>' +
        '<pre><code class="language-ts">a &lt; b</code></pre>' +
        "<hr>",
    );
  });

  it("escapes text", () => {
    const html = documentHtml(
      doc({
        type: "paragraph",
        content: [text('<script>alert("x")</script>')],
      }),
    );
    expect(html).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>",
    );
  });

  it("keeps safe links with a fixed rel and drops unsafe ones", () => {
    const link = (href: string, rel?: string) =>
      documentHtml(
        doc({
          type: "paragraph",
          content: [
            text("l", [
              { type: "link", attrs: { href, ...(rel ? { rel } : {}) } },
            ]),
          ],
        }),
      );
    expect(link("https://example.org/?a=1&b=2", "nofollow")).toBe(
      '<p><a href="https://example.org/?a=1&amp;b=2" rel="noopener">l</a></p>',
    );
    expect(link("javascript:alert(1)")).toBe("<p>l</p>");
    expect(link("//evil.example")).toBe("<p>l</p>");
  });

  it("shows only our own images", () => {
    const image = (src: string, alt?: string) =>
      documentHtml(
        doc({ type: "image", attrs: { src, ...(alt ? { alt } : {}) } }),
      );
    const id = "00000000-0000-4000-8000-000000000000";
    expect(image(`/api/media/${id}`, 'a "b"')).toBe(
      `<img src="/api/media/${id}" alt="a &quot;b&quot;" loading="lazy">`,
    );
    expect(image("https://tracker.example/p.gif")).toBe("");
  });
});
