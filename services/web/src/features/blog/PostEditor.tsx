import { useAtomSet } from "@effect/atom-react";
import {
  type BlogSlug,
  BlogLimits,
  emptyDocument,
  type ManagedPost,
  type MediaId,
  type PostInput,
  PostSlug,
} from "@unhalteproblem.de/api";
import type { JSONContent } from "@tiptap/react";
import { Exit, Option, Schema } from "effect";
import {
  Eye,
  EyeOff,
  ImagePlus,
  Save,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorTag, failureMessage } from "#api/errors.ts";
import {
  documentProblem,
  fromEditorContent,
  toEditorContent,
} from "#editor/convert.ts";
import { RichDocument } from "#editor/RichDocument.tsx";
import { slugify } from "#lib/slug.ts";
import { AutoTextarea } from "#ui/AutoTextarea.tsx";
import { Alert } from "#ui/Alert.tsx";
import { Badge } from "#ui/Badge.tsx";
import { Button } from "#ui/Button.tsx";
import { Dialog } from "#ui/Dialog.tsx";
import { Field, Input } from "#ui/Field.tsx";
import { useToast } from "#ui/Toast.tsx";
import {
  createPost,
  deletePost,
  postChanged,
  publishPost,
  unpublishPost,
  updatePost,
  uploadMedia,
} from "./blogAtoms.ts";
import { PostHeader } from "./PostHeader.tsx";

const decodeSlug = Schema.decodeUnknownOption(PostSlug);

const messages = {
  PostSlugTaken: "Another post of this blog already uses this URL slug.",
  PostNotFound: "This post doesn't exist any more.",
  BlogNotFound: "This blog doesn't exist any more.",
  UnsupportedMedia:
    "Only PNG, JPEG, WebP, GIF and AVIF images can be uploaded.",
  MediaTooLarge: "Images can be at most 5 MiB.",
  InvalidUpload: "The upload was not understood. Try again.",
};

/** Tags from what the editor typed: slugs, unique, at most 10. */
const parseTags = (text: string): ReadonlyArray<string> =>
  [
    ...new Set(
      text
        .split(/[,\s]+/)
        .map((tag) => slugify(tag, BlogLimits.tagMaxLength))
        .filter(Boolean),
    ),
  ].slice(0, BlogLimits.maxTags);

/** Uploads an image for the posts of `blog` and returns it. */
export const useUploadImage = (blog: BlogSlug) => {
  const upload = useAtomSet(uploadMedia, { mode: "promiseExit" });
  return useCallback(
    async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const exit = await upload({ params: { blog }, payload: form });
      if (Exit.isSuccess(exit)) return exit.value;
      throw new Error(failureMessage(exit, messages));
    },
    [upload, blog],
  );
};

/**
 * Writing a post in place: the post's own layout, with title, summary and
 * text editable, and a bar to save, publish or delete. `post` is `null` for
 * a new post, which is created (as a draft) by the first save.
 */
export function PostEditor({
  blog,
  post,
  onSaved,
  onClose,
  onDeleted,
}: {
  readonly blog: BlogSlug;
  readonly post: ManagedPost | null;
  /** After every successful save, publish or unpublish. */
  readonly onSaved: (post: ManagedPost) => void;
  /** Leave the editor (only offered when there's nothing unsaved). */
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}) {
  const create = useAtomSet(createPost, { mode: "promiseExit" });
  const update = useAtomSet(updatePost, { mode: "promiseExit" });
  const publish = useAtomSet(publishPost, { mode: "promiseExit" });
  const unpublish = useAtomSet(unpublishPost, { mode: "promiseExit" });
  const remove = useAtomSet(deletePost, { mode: "promiseExit" });
  const uploadImage = useUploadImage(blog);
  const toast = useToast();

  const [saved, setSaved] = useState(post);
  const [title, setTitle] = useState(post?.title ?? "");
  const [summary, setSummary] = useState(post?.summary ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  // A new post's slug follows its title until the editor changes it.
  const [slugEdited, setSlugEdited] = useState(post !== null);
  const [tags, setTags] = useState(post?.tags.join(", ") ?? "");
  const [cover, setCover] = useState<MediaId | null>(post?.coverImage ?? null);
  const content = useRef<JSONContent>(
    toEditorContent(post?.content ?? emptyDocument),
  );
  const [dirty, setDirty] = useState(post === null);
  const [busy, setBusy] = useState<"save" | "status" | "delete" | "cover">();
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(post === null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const effectiveSlug = slugEdited ? slug : slugify(title);
  const slugValid = Option.isSome(decodeSlug(effectiveSlug));
  const changed = () => setDirty(true);

  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const input = (): PostInput | string => {
    if (title.trim() === "") return "Give the post a title.";
    if (!slugValid)
      return "The URL slug may only contain a-z, 0-9 and single hyphens.";
    const document = fromEditorContent(content.current);
    const problem = documentProblem(document);
    if (problem !== undefined || Exit.isFailure(document)) return problem ?? "";
    return {
      slug: effectiveSlug,
      title: title.trim(),
      summary: summary.trim(),
      tags: parseTags(tags),
      coverImage: cover,
      content: document.value,
    };
  };

  const save = async (): Promise<ManagedPost | undefined> => {
    const payload = input();
    if (typeof payload === "string") {
      setError(payload);
      return undefined;
    }
    setBusy("save");
    setError(undefined);
    const reactivityKeys = postChanged(blog);
    const exit: Exit.Exit<ManagedPost, unknown> =
      saved === null
        ? await create({ params: { blog }, payload, reactivityKeys })
        : await update({
            params: { blog, postId: saved.id },
            payload: { ...payload, version: saved.version },
            reactivityKeys,
          });
    setBusy(undefined);
    if (Exit.isSuccess(exit)) {
      setSaved(exit.value);
      setSlug(exit.value.slug);
      setSlugEdited(true);
      setDirty(false);
      toast("success", "Saved.");
      onSaved(exit.value);
      return exit.value;
    }
    if (errorTag(exit.cause) === "PostEditConflict") {
      setConflict(true);
    } else {
      setError(failureMessage(exit, messages));
    }
    return undefined;
  };

  const toggleStatus = async () => {
    // Publishing publishes what is saved, so save first.
    const current = dirty ? await save() : (saved ?? undefined);
    if (current === undefined) return;
    setBusy("status");
    const request = {
      params: { blog, postId: current.id },
      reactivityKeys: postChanged(blog),
    };
    const exit: Exit.Exit<ManagedPost, unknown> =
      current.status === "published"
        ? await unpublish(request)
        : await publish(request);
    setBusy(undefined);
    if (Exit.isSuccess(exit)) {
      setSaved(exit.value);
      toast(
        "success",
        exit.value.status === "published"
          ? "Published."
          : "Moved back to drafts.",
      );
      onSaved(exit.value);
    } else {
      setError(failureMessage(exit, messages));
    }
  };

  const onDelete = async () => {
    if (saved === null) return onDeleted();
    setBusy("delete");
    const exit = await remove({
      params: { blog, postId: saved.id },
      reactivityKeys: postChanged(blog),
    });
    setBusy(undefined);
    setConfirmDelete(false);
    if (Exit.isSuccess(exit)) {
      setDirty(false);
      toast("success", "Post deleted.");
      onDeleted();
    } else {
      setError(failureMessage(exit, messages));
    }
  };

  const onCover = async (file: File | undefined) => {
    if (file === undefined) return;
    setBusy("cover");
    try {
      const media = await uploadImage(file);
      setCover(media.id);
      changed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(undefined);
    }
  };

  // Ctrl/Cmd+S saves.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const status = saved?.status ?? "draft";

  return (
    <article>
      <div className="sticky top-16 z-30 -mx-4 border-b border-accent/30 bg-bg/90 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status === "published" ? "accent" : "warning"}>
            {status}
          </Badge>
          <span className="font-mono text-xs text-muted">
            {dirty
              ? "unsaved changes"
              : saved === null
                ? "new"
                : `v${saved.version} saved`}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={<Settings2 size={15} />}
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <span className="hidden sm:inline">Settings</span>
            </Button>
            {saved !== null && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={15} />}
                onClick={() => setConfirmDelete(true)}
              >
                <span className="hidden sm:inline">Delete</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "status"}
              disabled={busy !== undefined}
              icon={
                status === "published" ? (
                  <EyeOff size={15} />
                ) : (
                  <Eye size={15} />
                )
              }
              onClick={toggleStatus}
            >
              {status === "published" ? "Unpublish" : "Publish"}
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy === "save"}
              disabled={busy !== undefined || !dirty}
              icon={<Save size={15} />}
              onClick={() => void save()}
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

      {conflict && (
        <Alert
          tone="warning"
          title="Someone else saved this post meanwhile."
          className="mt-4"
        >
          Your changes were not saved, so nothing of theirs was lost. Copy what
          you need, then reload the page to continue from their version.
        </Alert>
      )}
      {error !== undefined && (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      )}

      {settingsOpen && (
        <div className="animate-fade-up mt-4 grid gap-4 rounded-xl border border-border bg-surface/80 p-4 sm:grid-cols-2">
          <Field
            label="URL slug"
            hint={`/blog/${blog}/${effectiveSlug || "…"}`}
            error={
              effectiveSlug !== "" && !slugValid
                ? "a-z, 0-9 and single hyphens"
                : undefined
            }
          >
            {(control) => (
              <Input
                {...control}
                value={effectiveSlug}
                maxLength={BlogLimits.postSlugMaxLength}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(e.target.value);
                  changed();
                }}
              />
            )}
          </Field>
          <Field label="Tags" hint="Comma separated, at most 10.">
            {(control) => (
              <Input
                {...control}
                value={tags}
                placeholder="effect, typescript"
                onChange={(e) => {
                  setTags(e.target.value);
                  changed();
                }}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <label className="inline-flex cursor-pointer">
              <span className="sr-only">Cover image</span>
              <input
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                onChange={(e) => void onCover(e.target.files?.[0])}
              />
              <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-strong bg-surface-2 px-3 text-sm text-fg hover:border-accent/60">
                <ImagePlus size={15} />{" "}
                {busy === "cover"
                  ? "Uploading…"
                  : cover === null
                    ? "Add cover image"
                    : "Replace cover"}
              </span>
            </label>
            {cover !== null && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCover(null);
                  changed();
                }}
              >
                Remove cover
              </Button>
            )}
          </div>
        </div>
      )}

      <PostHeader
        blog={blog}
        publishedAt={saved?.publishedAt ?? null}
        author={saved?.author ?? { name: null }}
        tags={parseTags(tags)}
        coverImage={cover}
        title={
          <AutoTextarea
            aria-label="Title"
            placeholder="Title"
            maxLength={BlogLimits.postTitleMaxLength}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value.replace(/\n/g, " "));
              changed();
            }}
            className="-mx-2 px-2 font-display text-4xl leading-tight font-semibold text-fg sm:text-5xl"
          />
        }
        summary={
          <AutoTextarea
            aria-label="Summary"
            placeholder="A sentence or two that make people want to read this."
            maxLength={BlogLimits.postSummaryMaxLength}
            value={summary}
            onChange={(e) => {
              setSummary(e.target.value);
              changed();
            }}
            className="-mx-2 px-2 text-xl text-fg-soft"
          />
        }
      />

      <RichDocument
        content={content.current}
        editable
        placeholder="Start writing… (Markdown shortcuts like ## or ``` work)"
        uploadImage={async (file) => (await uploadImage(file)).url}
        onChange={(next) => {
          content.current = next;
          changed();
        }}
      />

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this post?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy === "delete"}
              onClick={onDelete}
            >
              Delete
            </Button>
          </>
        }
      >
        “{saved?.title}” will be gone for good, published or not.
      </Dialog>
    </article>
  );
}
