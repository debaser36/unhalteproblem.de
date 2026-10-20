import { useAtomSet } from "@effect/atom-react";
import {
  type Blog,
  BlogLimits,
  BlogSlug,
  BlogSlugMaxLength,
} from "@unhalteproblem.de/api";
import { Exit, Option, Schema } from "effect";
import { Check, Pencil, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { ApiClient } from "#api/ApiClient.ts";
import { AsyncView } from "#api/AsyncView.tsx";
import { failureMessage } from "#api/errors.ts";
import { blogsAtom, blogsKey, blogKey } from "#features/blog/blogAtoms.ts";
import { slugify } from "#lib/slug.ts";
import { formatDate } from "#lib/format.ts";
import { Button } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { Field, Input, Textarea } from "#ui/Field.tsx";
import { useToast } from "#ui/Toast.tsx";
import { AdminHeading } from "./AdminHeading.tsx";

const createBlog = ApiClient.mutation("admin", "createBlog");
const updateBlog = ApiClient.mutation("admin", "updateBlog");
const decodeSlug = Schema.decodeUnknownOption(BlogSlug);

export function BlogsAdminPage() {
  return (
    <>
      <AdminHeading title="Blogs">
        Subblogs. Their posts are written by users with{" "}
        <code className="font-mono text-accent">blogEditor:&lt;slug&gt;</code>,
        which a superAdmin grants on the user&apos;s page.
      </AdminHeading>
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <AsyncView atom={blogsAtom}>
          {(blogs) =>
            blogs.length === 0 ? (
              <EmptyState title="No blogs yet.">
                Create the first one.
              </EmptyState>
            ) : (
              <div className="space-y-3">
                {blogs.map((blog) => (
                  <BlogRow key={blog.slug} blog={blog} />
                ))}
              </div>
            )
          }
        </AsyncView>
        <CreateBlogForm />
      </div>
    </>
  );
}

function CreateBlogForm() {
  const create = useAtomSet(createBlog, { mode: "promiseExit" });
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState<string>();
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const effectiveSlug = slug ?? slugify(title, BlogSlugMaxLength);
  const validSlug = Option.isSome(decodeSlug(effectiveSlug));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validSlug) return;
    setPending(true);
    const exit = await create({
      payload: {
        slug: effectiveSlug,
        title: title.trim(),
        description: description.trim(),
      },
      reactivityKeys: [blogsKey],
    });
    setPending(false);
    const error = failureMessage(exit, {
      BlogSlugTaken: "A blog with this slug exists already.",
    });
    toast(
      error === undefined ? "success" : "error",
      error ?? `Created ${effectiveSlug}.`,
    );
    if (Exit.isSuccess(exit)) {
      setTitle("");
      setSlug(undefined);
      setDescription("");
    }
  };

  return (
    <Card className="h-fit p-5">
      <h2 className="font-semibold text-fg">New blog</h2>
      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <Field label="Title">
          {(control) => (
            <Input
              {...control}
              required
              maxLength={BlogLimits.blogTitleMaxLength}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Slug"
          hint="In URLs and in the editor role. Can't be changed later."
          error={
            effectiveSlug !== "" && !validSlug
              ? "a-z, 0-9 and single hyphens"
              : undefined
          }
        >
          {(control) => (
            <Input
              {...control}
              required
              maxLength={BlogSlugMaxLength}
              value={effectiveSlug}
              onChange={(e) => setSlug(e.target.value)}
            />
          )}
        </Field>
        <Field label="Description">
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={BlogLimits.blogDescriptionMaxLength}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          icon={<Plus size={15} />}
        >
          Create
        </Button>
      </form>
    </Card>
  );
}

function BlogRow({ blog }: { readonly blog: Blog }) {
  const update = useAtomSet(updateBlog, { mode: "promiseExit" });
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(blog.title);
  const [description, setDescription] = useState(blog.description);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    const exit = await update({
      params: { blog: blog.slug },
      payload: { title: title.trim(), description: description.trim() },
      reactivityKeys: [blogsKey, blogKey(blog.slug)],
    });
    setPending(false);
    const error = failureMessage(exit);
    toast(error === undefined ? "success" : "error", error ?? "Saved.");
    if (Exit.isSuccess(exit)) setEditing(false);
  };

  return (
    <Card className="p-5">
      {editing ? (
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Title">
            {(control) => (
              <Input
                {...control}
                required
                maxLength={BlogLimits.blogTitleMaxLength}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <Field label="Description">
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={BlogLimits.blogDescriptionMaxLength}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              loading={pending}
              icon={<Check size={14} />}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link
              to={`/blog/${blog.slug}`}
              className="font-semibold text-fg hover:text-accent"
            >
              {blog.title}
            </Link>
            <p className="font-mono text-xs text-muted">
              {blog.slug} · {blog.postCount} published · since{" "}
              {formatDate(blog.createdAt)}
            </p>
            {blog.description !== "" && (
              <p className="mt-2 text-sm text-fg-soft">{blog.description}</p>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<Pencil size={14} />}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        </div>
      )}
    </Card>
  );
}
