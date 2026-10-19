import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TextAlign } from "@tiptap/extension-text-align";
import { Placeholder } from "@tiptap/extensions";
import type { Extensions } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

/** The languages offered for code blocks, as lowlight names them. */
export const codeLanguages = lowlight.listLanguages().sort();

/**
 * Protocols a link may use. The backend's `SafeHref` enforces the same
 * (plus site-relative paths and fragments); this only stops the editor from
 * creating links the backend would refuse.
 */
export const isAllowedHref = (href: string) =>
  /^(https?:|mailto:)/i.test(href) ||
  (href.startsWith("/") && !href.startsWith("//")) ||
  href.startsWith("#");

/**
 * The document schema shared by the viewer and the editor, so a document
 * looks the same while it is edited. Every node and mark here must be one
 * the contract's `Document` accepts (and the other way round).
 */
export const documentExtensions = (placeholder?: string): Extensions => [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4] },
    // Replaced by the highlighting variant below.
    codeBlock: false,
    link: {
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
      protocols: ["http", "https", "mailto"],
      isAllowedUri: (url) => isAllowedHref(url),
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
    },
  }),
  CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
  Image.configure({ inline: false, allowBase64: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Highlight,
  Subscript,
  Superscript,
  Placeholder.configure({ placeholder: placeholder ?? "Write something…" }),
];
