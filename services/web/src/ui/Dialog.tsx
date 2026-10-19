import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "./Button.tsx";

/**
 * A modal dialog on top of the native `<dialog>`, which brings focus
 * trapping, Escape and the backdrop for free.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === ref.current) onClose();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-border-strong bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      {open && (
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close"
              onClick={onClose}
              icon={<X size={16} />}
            />
          </div>
          <div className="text-sm text-fg-soft">{children}</div>
          {footer !== undefined && (
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
