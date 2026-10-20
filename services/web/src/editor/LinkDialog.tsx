import type { Editor } from "@tiptap/react";
import { type FormEvent, useState } from "react";
import { Button } from "#ui/Button.tsx";
import { Dialog } from "#ui/Dialog.tsx";
import { Field, Input } from "#ui/Field.tsx";
import { isAllowedHref } from "./extensions.ts";

/** Sets, changes or removes the link at the selection. */
export function LinkDialog({
  editor,
  open,
  onClose,
}: {
  readonly editor: Editor;
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Link">
      {/* The dialog renders its content only while open, so the form starts from the selection's link each time. */}
      <LinkForm editor={editor} onClose={onClose} />
    </Dialog>
  );
}

function LinkForm({
  editor,
  onClose,
}: {
  readonly editor: Editor;
  readonly onClose: () => void;
}) {
  const [href, setHref] = useState(
    () => (editor.getAttributes("link").href as string | undefined) ?? "",
  );
  const valid = href.trim() === "" || isAllowedHref(href.trim());

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const value = href.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (value === "") chain.unsetLink().run();
    else if (isAllowedHref(value)) chain.setLink({ href: value }).run();
    else return;
    onClose();
  };

  return (
    <form onSubmit={apply} className="space-y-4">
      <Field
        label="URL"
        hint="https://…, mailto:…, or a path on this site like /blog"
        error={
          valid
            ? undefined
            : "Only http(s), mailto, site paths and #anchors are allowed."
        }
      >
        {(control) => (
          <Input
            {...control}
            autoFocus
            placeholder="https://"
            value={href}
            onChange={(event) => setHref(event.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            onClose();
          }}
        >
          Remove link
        </Button>
        <Button type="submit" variant="primary" disabled={!valid}>
          Apply
        </Button>
      </div>
    </form>
  );
}
