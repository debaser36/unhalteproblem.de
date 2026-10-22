import { useAtomSet, useAtomValue } from "@effect/atom-react";
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
import { AsyncResult } from "effect/reactivity";
import { Eye, EyeOff } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { errorTag, failureMessage } from "#api/errors.ts";
import {
  documentProblem,
  fromEditorContent,
  toEditorContent,
} from "#editor/convert.ts";
import { CoverPicker } from "#editor/CoverPicker.tsx";
import { EditorBar } from "#editor/EditorBar.tsx";
import { useSaveShortcut, useUnsavedChangesWarning } from "#editor/hooks.ts";
import { RichDocument } from "#editor/RichDocument.tsx";
import { uploadMessages } from "#editor/uploadMessages.ts";
import { slugify } from "#lib/slug.ts";
import { categoriesInput } from "#lib/categories.ts";
import { parseTags } from "#lib/tags.ts";
import { Alert } from "#ui/Alert.tsx";
import { AutoTextarea } from "#ui/AutoTextarea.tsx";
import { Button } from "#ui/Button.tsx";
import { Dialog } from "#ui/Dialog.tsx";
import { Field, Input } from "#ui/Field.tsx";
import { useToast } from "#ui/toasts.ts";
import { type CategoryChoice, CategoryFields } from "./CategoryFields.tsx";
import {
  blogAtom,
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
  ...uploadMessages,
  PostSlugTaken: "Another post of this blog already uses this URL slug.",
  PostNotFound: "This post doesn't exist any more.",
  BlogNotFound: "This blog doesn't exist any more.",
};

/** Uploads an image for the posts of `blog` and returns it. */
const useUploadImage = (blog: BlogSlug) => {
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
  // A new post starts in its subblog's main category, once that is loaded.
  const blogInfo = useAtomValue(blogAtom(blog));
  const [categories, setCategories] = useState<CategoryChoice | undefined>(
    post === null
      ? undefined
      : {
          main: post.categories.main.name,
          extra: post.categories.extra.map(({ name }) => name),
        },
  );
  const categoryChoice: CategoryChoice = categories ?? {
    main: AsyncResult.isSuccess(blogInfo)
      ? blogInfo.value.categories.main.name
      : "",
    extra: [],
  };
  const chosenCategories = categoriesInput(
    categoryChoice.main,
    categoryChoice.extra,
  );
  // The editor reads its content once; the ref follows the edits for saving.
  const [initialContent] = useState(() =>
    toEditorContent(post?.content ?? emptyDocument),
  );
  const content = useRef<JSONContent>(initialContent);
  const [dirty, setDirty] = useState(post === null);
  const [busy, setBusy] = useState<"save" | "status" | "delete">();
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(post === null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const effectiveSlug = slugEdited
    ? slug
    : slugify(title, BlogLimits.postSlugMaxLength);
  const slugValid = Option.isSome(decodeSlug(effectiveSlug));
  const changed = () => setDirty(true);

  useUnsavedChangesWarning(dirty);

  const input = (): PostInput | string => {
    if (title.trim() === "") return "Give the post a title.";
    if (!slugValid) {
      return "The URL slug may only contain a-z, 0-9 and single hyphens.";
    }
    if (typeof chosenCategories === "string") {
      setSettingsOpen(true);
      return chosenCategories;
    }
    const document = fromEditorContent(content.current);
    if (Exit.isFailure(document)) return documentProblem(document) ?? "";
    return {
      slug: effectiveSlug,
      title: title.trim(),
      summary: summary.trim(),
      tags: parseTags(tags),
      categories: chosenCategories,
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
    if (errorTag(exit.cause) === "PostEditConflict") setConflict(true);
    else setError(failureMessage(exit, messages));
    return undefined;
  };

  useSaveShortcut(() => void save());

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

  const status = saved?.status ?? "draft";

  return (
    <article>
      <EditorBar
        status={status}
        statusTone={status === "published" ? "accent" : "warning"}
        state={saved === null ? "new" : `v${saved.version} saved`}
        dirty={dirty}
        saving={busy === "save"}
        busy={busy !== undefined}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        onSave={() => void save()}
        onDelete={saved === null ? undefined : () => setConfirmDelete(true)}
        onClose={onClose}
      >
        <Button
          size="sm"
          variant="secondary"
          loading={busy === "status"}
          disabled={busy !== undefined}
          icon={
            status === "published" ? <EyeOff size={15} /> : <Eye size={15} />
          }
          onClick={toggleStatus}
        >
          {status === "published" ? "Unpublish" : "Publish"}
        </Button>
      </EditorBar>

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
          <CategoryFields
            value={categoryChoice}
            error={
              categories !== undefined && typeof chosenCategories === "string"
                ? chosenCategories
                : undefined
            }
            onChange={(next) => {
              setCategories(next);
              changed();
            }}
          />
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
          <div className="sm:col-span-2">
            <CoverPicker
              cover={cover}
              upload={uploadImage}
              onError={setError}
              onChange={(next) => {
                setCover(next);
                changed();
              }}
            />
          </div>
        </div>
      )}

      <PostHeader
        blog={blog}
        publishedAt={saved?.publishedAt ?? null}
        author={saved?.author ?? { id: null, name: null }}
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
        content={initialContent}
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
