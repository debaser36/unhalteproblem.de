import { emptyDocument } from "@unhalteproblem.de/api";
import { Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  documentProblem,
  fromEditorContent,
  toEditorContent,
} from "./convert.ts";

const image = (src: string) => ({
  type: "doc",
  content: [{ type: "image", attrs: { src, alt: "", title: null } }],
});

describe("convert", () => {
  it("round-trips a stored document", () => {
    const exit = fromEditorContent(toEditorContent(emptyDocument));
    expect(exit).toEqual(Exit.succeed(emptyDocument));
    expect(documentProblem(exit)).toBeUndefined();
  });

  it("accepts our own uploads", () => {
    const exit = fromEditorContent(
      image("/api/media/55555555-5555-4555-8555-555555555555"),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("refuses an image from another site with a message", () => {
    const exit = fromEditorContent(image("https://example.org/cat.png"));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(documentProblem(exit)).toMatch(/image from another site/);
  });
});
