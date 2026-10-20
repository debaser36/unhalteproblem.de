import type { MediaId, MediaInfo } from "@unhalteproblem.de/api";
import { ImagePlus } from "lucide-react";
import { useState } from "react";
import { Button } from "#ui/Button.tsx";

/** Uploads, replaces or removes a document's cover image. */
export function CoverPicker({
  cover,
  upload,
  onChange,
  onError,
}: {
  readonly cover: MediaId | null;
  readonly upload: (file: File) => Promise<MediaInfo>;
  readonly onChange: (cover: MediaId | null) => void;
  readonly onError: (message: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const onFile = async (file: File | undefined) => {
    if (file === undefined) return;
    setUploading(true);
    try {
      onChange((await upload(file)).id);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex cursor-pointer">
        <span className="sr-only">Cover image</span>
        <input
          type="file"
          className="hidden"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-strong bg-surface-2 px-3 text-sm text-fg hover:border-accent/60">
          <ImagePlus size={15} />
          {uploading
            ? "Uploading…"
            : cover === null
              ? "Add cover image"
              : "Replace cover"}
        </span>
      </label>
      {cover !== null && (
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Remove cover
        </Button>
      )}
    </div>
  );
}
