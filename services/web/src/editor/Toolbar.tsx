import { type Editor, useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  Bold,
  Code,
  Code2,
  Heading2,
  Heading3,
  Heading4,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { cn } from "#lib/cn.ts";
import { Spinner } from "#ui/Spinner.tsx";
import { useToast } from "#ui/Toast.tsx";
import { codeLanguages } from "./extensions.ts";
import { LinkDialog } from "./LinkDialog.tsx";

function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  readonly label: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep the selection in the document while clicking the toolbar.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40",
        active
          ? "bg-accent-soft text-accent"
          : "text-fg-soft hover:bg-surface-3 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <span
      aria-hidden="true"
      className="mx-1 h-5 w-px shrink-0 bg-border-strong"
    />
  );
}

export function Toolbar({
  editor,
  uploadImage,
}: {
  readonly editor: Editor;
  readonly uploadImage?: ((file: File) => Promise<string>) | undefined;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      highlight: e.isActive("highlight"),
      link: e.isActive("link"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      h4: e.isActive("heading", { level: 4 }),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      blockquote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      codeLanguage:
        (e.getAttributes("codeBlock").language as string | null) ?? "",
      center: e.isActive({ textAlign: "center" }),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const chain = () => editor.chain().focus();

  const onFile = async (file: File | undefined) => {
    if (file === undefined || uploadImage === undefined) return;
    setUploading(true);
    try {
      const src = await uploadImage(file);
      chain()
        .setImage({ src, alt: file.name.replace(/\.[^.]+$/, "") })
        .run();
    } catch (error) {
      toast("error", error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current !== null) fileInput.current.value = "";
    }
  };

  return (
    // Sticks below the site header (4rem) and the editor bar above it.
    <div
      role="toolbar"
      aria-label="Formatting"
      className="sticky top-[calc(4rem+3.3rem)] z-20 flex items-center gap-0.5 overflow-x-auto sm:flex-wrap sm:overflow-visible rounded-t-xl border-b border-border bg-surface-2/95 px-2 py-1.5 backdrop-blur"
    >
      <ToolButton
        label="Undo"
        disabled={!state.canUndo}
        onClick={() => chain().undo().run()}
      >
        <Undo2 size={16} />
      </ToolButton>
      <ToolButton
        label="Redo"
        disabled={!state.canRedo}
        onClick={() => chain().redo().run()}
      >
        <Redo2 size={16} />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Heading 2"
        active={state.h2}
        onClick={() => chain().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 size={16} />
      </ToolButton>
      <ToolButton
        label="Heading 3"
        active={state.h3}
        onClick={() => chain().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 size={16} />
      </ToolButton>
      <ToolButton
        label="Heading 4"
        active={state.h4}
        onClick={() => chain().toggleHeading({ level: 4 }).run()}
      >
        <Heading4 size={16} />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Bold"
        active={state.bold}
        onClick={() => chain().toggleBold().run()}
      >
        <Bold size={16} />
      </ToolButton>
      <ToolButton
        label="Italic"
        active={state.italic}
        onClick={() => chain().toggleItalic().run()}
      >
        <Italic size={16} />
      </ToolButton>
      <ToolButton
        label="Underline"
        active={state.underline}
        onClick={() => chain().toggleUnderline().run()}
      >
        <Underline size={16} />
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        active={state.strike}
        onClick={() => chain().toggleStrike().run()}
      >
        <Strikethrough size={16} />
      </ToolButton>
      <ToolButton
        label="Inline code"
        active={state.code}
        onClick={() => chain().toggleCode().run()}
      >
        <Code size={16} />
      </ToolButton>
      <ToolButton
        label="Highlight"
        active={state.highlight}
        onClick={() => chain().toggleHighlight().run()}
      >
        <Highlighter size={16} />
      </ToolButton>
      <ToolButton
        label="Link"
        active={state.link}
        onClick={() => setLinkOpen(true)}
      >
        <Link2 size={16} />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Bullet list"
        active={state.bulletList}
        onClick={() => chain().toggleBulletList().run()}
      >
        <List size={16} />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={state.orderedList}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrdered size={16} />
      </ToolButton>
      <ToolButton
        label="Task list"
        active={state.taskList}
        onClick={() => chain().toggleTaskList().run()}
      >
        <ListChecks size={16} />
      </ToolButton>
      <ToolButton
        label="Quote"
        active={state.blockquote}
        onClick={() => chain().toggleBlockquote().run()}
      >
        <Quote size={16} />
      </ToolButton>
      <ToolButton
        label="Code block"
        active={state.codeBlock}
        onClick={() => chain().toggleCodeBlock().run()}
      >
        <Code2 size={16} />
      </ToolButton>
      {state.codeBlock && (
        <select
          aria-label="Code language"
          value={state.codeLanguage}
          onChange={(event) =>
            chain()
              .updateAttributes("codeBlock", {
                language: event.target.value || null,
              })
              .run()
          }
          className="h-8 shrink-0 rounded-md border border-border-strong bg-surface px-1.5 font-mono text-xs text-fg"
        >
          <option value="">plain</option>
          {codeLanguages.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
        </select>
      )}
      <ToolButton
        label="Divider"
        onClick={() => chain().setHorizontalRule().run()}
      >
        <Minus size={16} />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Align left"
        active={!state.center}
        onClick={() => chain().unsetTextAlign().run()}
      >
        <AlignLeft size={16} />
      </ToolButton>
      <ToolButton
        label="Center"
        active={state.center}
        onClick={() => chain().setTextAlign("center").run()}
      >
        <AlignCenter size={16} />
      </ToolButton>
      {uploadImage !== undefined && (
        <>
          <Divider />
          <ToolButton
            label="Insert image"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? <Spinner size={14} /> : <ImagePlus size={16} />}
          </ToolButton>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            className="hidden"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
        </>
      )}
      <LinkDialog
        editor={editor}
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
      />
    </div>
  );
}
