import { useAtomSet } from "@effect/atom-react";
import {
  emptyDocument,
  HttpUrl,
  type ManagedProject,
  type MediaId,
  type ProjectInput,
  ProjectLimits,
  ProjectSlug,
  type ProjectStatus,
} from "@unhalteproblem.de/api";
import type { JSONContent } from "@tiptap/react";
import { Exit, Option, Schema } from "effect";
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
import { parseTags } from "#lib/tags.ts";
import { slugify } from "#lib/slug.ts";
import { Alert } from "#ui/Alert.tsx";
import { AutoTextarea } from "#ui/AutoTextarea.tsx";
import { Button } from "#ui/Button.tsx";
import { Dialog } from "#ui/Dialog.tsx";
import { Field, Input, Select } from "#ui/Field.tsx";
import { useToast } from "#ui/Toast.tsx";
import {
  createProject,
  deleteProject,
  projectsKey,
  updateProject,
  uploadProjectMedia,
} from "./projectAtoms.ts";
import { ProjectHeader } from "./ProjectHeader.tsx";

const decodeSlug = Schema.decodeUnknownOption(ProjectSlug);
const decodeUrl = Schema.decodeUnknownOption(HttpUrl);

const messages = {
  ...uploadMessages,
  ProjectSlugTaken: "Another project already uses this URL slug.",
  ProjectNotFound: "This project doesn't exist any more.",
};

/** A URL field's value: `null` when empty, `undefined` when invalid. */
const urlOf = (text: string): string | null | undefined => {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return Option.getOrUndefined(decodeUrl(trimmed));
};

const useUploadProjectImage = () => {
  const upload = useAtomSet(uploadProjectMedia, { mode: "promiseExit" });
  return useCallback(
    async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const exit = await upload({ payload: form });
      if (Exit.isSuccess(exit)) return exit.value;
      throw new Error(failureMessage(exit, messages));
    },
    [upload],
  );
};

/** Writing a project page in place (admins). `project` is `null` for a new one. */
export function ProjectEditor({
  project,
  onSaved,
  onClose,
  onDeleted,
}: {
  readonly project: ManagedProject | null;
  readonly onSaved: (project: ManagedProject) => void;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}) {
  const create = useAtomSet(createProject, { mode: "promiseExit" });
  const update = useAtomSet(updateProject, { mode: "promiseExit" });
  const remove = useAtomSet(deleteProject, { mode: "promiseExit" });
  const uploadImage = useUploadProjectImage();
  const toast = useToast();

  const [saved, setSaved] = useState(project);
  const [title, setTitle] = useState(project?.title ?? "");
  const [summary, setSummary] = useState(project?.summary ?? "");
  const [slug, setSlug] = useState(project?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(project !== null);
  const [tags, setTags] = useState(project?.tags.join(", ") ?? "");
  const [status, setStatus] = useState<ProjectStatus>(
    project?.status ?? "active",
  );
  const [featured, setFeatured] = useState(project?.featured ?? false);
  const [position, setPosition] = useState(String(project?.position ?? 0));
  const [repoUrl, setRepoUrl] = useState(project?.repoUrl ?? "");
  const [liveUrl, setLiveUrl] = useState(project?.liveUrl ?? "");
  const [published, setPublished] = useState(project?.published ?? false);
  const [cover, setCover] = useState<MediaId | null>(
    project?.coverImage ?? null,
  );
  const content = useRef<JSONContent>(
    toEditorContent(project?.content ?? emptyDocument),
  );
  const [dirty, setDirty] = useState(project === null);
  const [busy, setBusy] = useState<"save" | "delete">();
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(project === null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const effectiveSlug = slugEdited
    ? slug
    : slugify(title, ProjectLimits.slugMaxLength);
  const slugValid = Option.isSome(decodeSlug(effectiveSlug));
  const repo = urlOf(repoUrl);
  const live = urlOf(liveUrl);
  const changed = () => setDirty(true);

  useUnsavedChangesWarning(dirty);

  const input = (publish: boolean): ProjectInput | string => {
    if (title.trim() === "") return "Give the project a title.";
    if (!slugValid)
      return "The URL slug may only contain a-z, 0-9 and single hyphens.";
    if (repo === undefined || live === undefined) {
      return "Links must be full http(s) URLs, like https://github.com/…";
    }
    const at = Number(position);
    if (!Number.isInteger(at) || at < 0 || at > ProjectLimits.maxPosition) {
      return `The position must be a whole number from 0 to ${ProjectLimits.maxPosition}.`;
    }
    const document = fromEditorContent(content.current);
    if (Exit.isFailure(document)) return documentProblem(document) ?? "";
    return {
      slug: effectiveSlug,
      title: title.trim(),
      summary: summary.trim(),
      tags: parseTags(tags),
      status,
      featured,
      position: at,
      repoUrl: repo,
      liveUrl: live,
      coverImage: cover,
      content: document.value,
      published: publish,
    };
  };

  /** Saves, with `publish` as the new published state. */
  const save = async (publish = published) => {
    const payload = input(publish);
    if (typeof payload === "string") return setError(payload);
    setBusy("save");
    setError(undefined);
    const reactivityKeys = [projectsKey];
    const exit: Exit.Exit<ManagedProject, unknown> =
      saved === null
        ? await create({ payload, reactivityKeys })
        : await update({
            params: { projectId: saved.id },
            payload: { ...payload, version: saved.version },
            reactivityKeys,
          });
    setBusy(undefined);
    if (Exit.isSuccess(exit)) {
      setSaved(exit.value);
      setPublished(exit.value.published);
      setSlug(exit.value.slug);
      setSlugEdited(true);
      setDirty(false);
      toast("success", "Saved.");
      onSaved(exit.value);
    } else if (errorTag(exit.cause) === "ProjectEditConflict") {
      setConflict(true);
    } else {
      setError(failureMessage(exit, messages));
    }
  };

  useSaveShortcut(() => void save());

  const onDelete = async () => {
    if (saved === null) return onDeleted();
    setBusy("delete");
    const exit = await remove({
      params: { projectId: saved.id },
      reactivityKeys: [projectsKey],
    });
    setBusy(undefined);
    setConfirmDelete(false);
    if (Exit.isSuccess(exit)) {
      setDirty(false);
      toast("success", "Project deleted.");
      onDeleted();
    } else {
      setError(failureMessage(exit, messages));
    }
  };

  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      changed();
    };

  return (
    <article>
      <EditorBar
        status={published ? "published" : "hidden"}
        statusTone={published ? "accent" : "warning"}
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
          disabled={busy !== undefined}
          onClick={() => void save(!published)}
        >
          {published ? "Hide" : "Publish"}
        </Button>
      </EditorBar>

      {conflict && (
        <Alert
          tone="warning"
          title="Someone else saved this project meanwhile."
          className="mt-4"
        >
          Your changes were not saved. Copy what you need, then reload the page.
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
            hint={`/projects/${effectiveSlug || "…"}`}
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
                maxLength={ProjectLimits.slugMaxLength}
                onChange={(e) => {
                  setSlugEdited(true);
                  edit(setSlug)(e.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Tags" hint="Comma separated, at most 10.">
            {(control) => (
              <Input
                {...control}
                value={tags}
                onChange={(e) => edit(setTags)(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Source code"
            error={repo === undefined ? "a full http(s) URL" : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="url"
                placeholder="https://github.com/…"
                value={repoUrl}
                onChange={(e) => edit(setRepoUrl)(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Live version"
            error={live === undefined ? "a full http(s) URL" : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="url"
                placeholder="https://…"
                value={liveUrl}
                onChange={(e) => edit(setLiveUrl)(e.target.value)}
              />
            )}
          </Field>
          <Field label="Status">
            {(control) => (
              <Select
                {...control}
                value={status}
                onChange={(e) =>
                  edit(setStatus)(e.target.value as ProjectStatus)
                }
              >
                <option value="active">active</option>
                <option value="completed">completed</option>
                <option value="archived">archived</option>
              </Select>
            )}
          </Field>
          <Field
            label="Position"
            hint="Lower comes first, among equally featured projects."
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                min={0}
                max={ProjectLimits.maxPosition}
                value={position}
                onChange={(e) => edit(setPosition)(e.target.value)}
              />
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm text-fg-soft">
            <input
              type="checkbox"
              checked={featured}
              onChange={(e) => edit(setFeatured)(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Featured (shown first and bigger)
          </label>
          <CoverPicker
            cover={cover}
            upload={uploadImage}
            onError={setError}
            onChange={edit(setCover)}
          />
        </div>
      )}

      <ProjectHeader
        status={status}
        tags={parseTags(tags)}
        repoUrl={repo ?? null}
        liveUrl={live ?? null}
        coverImage={cover}
        title={
          <AutoTextarea
            aria-label="Title"
            placeholder="Project name"
            maxLength={ProjectLimits.titleMaxLength}
            value={title}
            onChange={(e) => edit(setTitle)(e.target.value.replace(/\n/g, " "))}
            className="-mx-2 px-2 font-display text-4xl leading-tight font-semibold text-fg sm:text-5xl"
          />
        }
        summary={
          <AutoTextarea
            aria-label="Summary"
            placeholder="What it is, in a sentence or two."
            maxLength={ProjectLimits.summaryMaxLength}
            value={summary}
            onChange={(e) => edit(setSummary)(e.target.value)}
            className="-mx-2 px-2 text-xl text-fg-soft"
          />
        }
      />

      <RichDocument
        content={content.current}
        editable
        placeholder="The story: why, how, what you learned…"
        uploadImage={async (file) => (await uploadImage(file)).url}
        onChange={(next) => {
          content.current = next;
          changed();
        }}
      />

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this project?"
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
        “{saved?.title}” and its write-up will be gone for good.
      </Dialog>
    </article>
  );
}
