import { Document } from "@unhalteproblem.de/api";
import type { JSONContent } from "@tiptap/react";
import { Exit, Schema } from "effect";

/**
 * A stored document as the editor's content. The contract's `Document` is
 * a subset of what TipTap reads (the editor's extensions mirror it), so
 * this only drops `readonly`.
 */
export const toEditorContent = (document: Document): JSONContent =>
  document as unknown as JSONContent;

const decodeDocument = Schema.decodeUnknownExit(Document);

/**
 * The editor's content as a `Document` the backend accepts, or why not
 * (e.g. an image pasted from another site). Attributes the contract does
 * not know are dropped.
 */
export const fromEditorContent = (
  content: JSONContent,
): Exit.Exit<Document, Schema.SchemaError> => decodeDocument(content);

/** A message about why the editor's content can't be saved. */
export const documentProblem = (
  exit: Exit.Exit<Document, Schema.SchemaError>,
) =>
  Exit.isSuccess(exit)
    ? undefined
    : "The text contains something that can't be saved here, for example an image from another site. Remove it and try again.";
