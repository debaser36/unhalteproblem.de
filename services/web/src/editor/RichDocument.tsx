import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo } from "react";
import { cn } from "#lib/cn.ts";
import { documentExtensions } from "./extensions.ts";
import { Toolbar } from "./Toolbar.tsx";

export interface RichDocumentProps {
  /** The document to show; read once, when the component mounts. */
  readonly content: JSONContent;
  /**
   * Whether the document can be edited. Switching it keeps the editor (and
   * its undo history), so editing happens in place, on the page as readers
   * see it.
   */
  readonly editable?: boolean;
  /** Called with the document after every change while editable. */
  readonly onChange?: (content: JSONContent) => void;
  /**
   * Uploads an image and returns the URL to embed. Without it the toolbar
   * offers no image button.
   */
  readonly uploadImage?: (file: File) => Promise<string>;
  readonly placeholder?: string;
  readonly className?: string;
}

/**
 * A rich document (post or project write-up): rendered read-only for
 * readers, and editable with a toolbar for its editors.
 */
export function RichDocument({
  content,
  editable = false,
  onChange,
  uploadImage,
  placeholder,
  className,
}: RichDocumentProps) {
  const extensions = useMemo(
    () => documentExtensions(placeholder),
    [placeholder],
  );
  const editor = useEditor({
    extensions,
    content,
    editable,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: cn("doc", className),
        ...(editable ? { "aria-label": "Document editor" } : {}),
      },
    },
    onUpdate: ({ editor }) => onChange?.(editor.getJSON()),
  });

  useEffect(() => {
    if (editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  return (
    <div
      className={cn(
        editable && "rounded-xl border border-accent/30 bg-surface/60",
      )}
    >
      {editable && <Toolbar editor={editor} uploadImage={uploadImage} />}
      <div className={cn(editable && "px-4 py-5 sm:px-6")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
