import { Save, Settings2, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "#ui/Badge.tsx";
import { Button } from "#ui/Button.tsx";

/**
 * The bar above a document edited in place: its state, settings, delete,
 * extra actions (publish) and save. Sticks below the site header.
 */
export function EditorBar({
  status,
  statusTone,
  state,
  dirty,
  saving,
  busy,
  settingsOpen,
  onToggleSettings,
  onSave,
  onDelete,
  onClose,
  children,
}: {
  readonly status: string;
  readonly statusTone: BadgeTone;
  /** What to say about the saved state, e.g. `v3 saved`. */
  readonly state: string;
  readonly dirty: boolean;
  readonly saving: boolean;
  /** Something is running: disables the actions. */
  readonly busy: boolean;
  readonly settingsOpen: boolean;
  readonly onToggleSettings: () => void;
  readonly onSave: () => void;
  /** Absent for a document that isn't saved yet. */
  readonly onDelete: (() => void) | undefined;
  readonly onClose: () => void;
  /** More actions before "Save", e.g. publish. */
  readonly children?: ReactNode;
}) {
  return (
    <div className="sticky top-16 z-30 -mx-4 border-b border-accent/30 bg-bg/90 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone}>{status}</Badge>
        <span className="font-mono text-xs text-muted">
          {dirty ? "unsaved changes" : state}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<Settings2 size={15} />}
            aria-expanded={settingsOpen}
            onClick={onToggleSettings}
          >
            <span className="hidden sm:inline">Settings</span>
          </Button>
          {onDelete !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={15} />}
              onClick={onDelete}
            >
              <span className="hidden sm:inline">Delete</span>
            </Button>
          )}
          {children}
          <Button
            size="sm"
            variant="primary"
            loading={saving}
            disabled={busy || !dirty}
            icon={<Save size={15} />}
            onClick={onSave}
            title="Save (Ctrl+S)"
          >
            Save
          </Button>
          {!dirty && (
            <Button
              size="sm"
              variant="ghost"
              aria-label="Close editor"
              icon={<X size={15} />}
              onClick={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
