import {
  Blog,
  BlogSlug,
  Categories,
  categorySlugOf,
  ManagedPost,
  PostEditConflict,
  type PostInput,
} from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { decode } from "#testing/fixtures.ts";
import { type Handlers, fakeApi } from "#testing/FakeApi.ts";
import { renderWithApi } from "#testing/render.tsx";
import { PostEditor } from "./PostEditor.tsx";

const blogSlug = decode(BlogSlug)("notes");

const blog = decode(Blog)({
  slug: "notes",
  title: "Notes",
  description: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  postCount: 1,
  latestPostAt: null,
  categories: {
    main: { slug: "programming", name: "Programming" },
    extra: [],
  },
});

const existing = decode(ManagedPost)({
  id: "33333333-3333-4333-8333-333333333333",
  blog: "notes",
  slug: "first-post",
  title: "First post",
  summary: "",
  tags: [],
  coverImage: null,
  status: "draft",
  publishedAt: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  version: 3,
  author: { id: null, name: "Ada" },
  categories: { main: { slug: "programming", name: "Programming" }, extra: [] },
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hi." }] }],
  },
});

/** What the backend answers after saving `input`. */
const savedAs = (input: PostInput, version: number): ManagedPost => ({
  ...existing,
  ...input,
  version: version as ManagedPost["version"],
  categories: decode(Categories)({
    main: {
      slug: categorySlugOf(input.categories.main),
      name: input.categories.main,
    },
    extra: input.categories.extra.map((name) => ({
      slug: categorySlugOf(name),
      name,
    })),
  }),
});

const editorApi = (blogEditor: NonNullable<Handlers["blogEditor"]>) =>
  fakeApi({
    blogs: {
      getBlog: () => Effect.succeed(blog),
      listCategories: () => Effect.succeed([]),
    },
    blogEditor,
  });

const renderEditor = (
  post: ManagedPost | null,
  api: ReturnType<typeof fakeApi>,
) => {
  const props = {
    onSaved: vi.fn<(post: ManagedPost) => void>(),
    onClose: vi.fn<() => void>(),
    onDeleted: vi.fn<() => void>(),
  };
  return renderWithApi(
    <PostEditor blog={blogSlug} post={post} {...props} />,
    api,
  ).then((rendered) => ({ ...rendered, props }));
};

describe("PostEditor", () => {
  it("creates a draft with a slug from the title and the blog's category", async () => {
    const api = editorApi({
      createPost: ({ payload }) => Effect.succeed(savedAs(payload, 1)),
    });
    const { screen, props } = await renderEditor(null, api);

    await screen.getByLabelText("Title").fill("Hello, World!");
    await expect
      .element(screen.getByLabelText("URL slug"))
      .toHaveValue("hello-world");
    await expect
      .element(screen.getByLabelText("Main category"))
      .toHaveValue("Programming");
    await screen.getByLabelText("Tags").fill("Effect, typescript");

    await screen.getByLabelText("Document editor").click();
    await userEvent.keyboard("## Intro{Enter}Some text");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Saved.");
    const [request] = api.callsTo("blogEditor", "createPost");
    expect(request).toMatchObject({
      params: { blog: "notes" },
      payload: {
        slug: "hello-world",
        title: "Hello, World!",
        tags: ["effect", "typescript"],
        categories: { main: "Programming", extra: [] },
        coverImage: null,
      },
    });
    // The Markdown shortcut made a heading; the editor keeps an empty
    // paragraph at the end to type into.
    expect(request?.payload.content.content).toMatchObject([
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Intro" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Some text" }],
      },
      { type: "paragraph" },
    ]);
    expect(props.onSaved).toHaveBeenCalledOnce();
    await expect.element(screen.getByText("v1 saved")).toBeVisible();
  });

  it("does not save without a title or with a bad slug", async () => {
    const api = editorApi({});
    const { screen } = await renderEditor(null, api);

    await screen.getByRole("button", { name: "Save" }).click();
    await expect
      .element(screen.getByText("Give the post a title."))
      .toBeVisible();

    await screen.getByLabelText("Title").fill("Fine title");
    await screen.getByLabelText("URL slug").fill("Not a slug");
    await screen.getByRole("button", { name: "Save" }).click();
    await expect
      .element(screen.getByText(/may only contain a-z, 0-9/))
      .toBeVisible();

    expect(api.calls.filter((call) => call.group === "blogEditor")).toEqual([]);
  });

  it("sends the version it edits and reports a conflicting save", async () => {
    const api = editorApi({
      updatePost: () =>
        Effect.fail(
          new PostEditConflict({
            currentVersion: 4 as ManagedPost["version"],
          }),
        ),
    });
    const { screen, props } = await renderEditor(existing, api);

    await screen.getByLabelText("Summary").fill("Now with a summary.");
    await screen.getByRole("button", { name: "Save" }).click();

    await expect
      .element(screen.getByText("Someone else saved this post meanwhile."))
      .toBeVisible();
    expect(api.callsTo("blogEditor", "updatePost")).toMatchObject([
      {
        params: { blog: "notes", postId: existing.id },
        payload: { version: 3, summary: "Now with a summary." },
      },
    ]);
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it("saves unsaved changes before publishing", async () => {
    const api = editorApi({
      updatePost: ({ payload }) => Effect.succeed(savedAs(payload, 4)),
      publishPost: () =>
        Effect.succeed({ ...existing, status: "published" as const }),
    });
    const { screen } = await renderEditor(existing, api);

    await screen.getByLabelText("Title").fill("First post, revised");
    await screen.getByRole("button", { name: "Publish" }).click();

    await expect
      .element(screen.getByRole("button", { name: "Unpublish" }))
      .toBeVisible();
    const order = api.calls
      .filter((call) => call.group === "blogEditor")
      .map((call) => call.endpoint);
    expect(order).toEqual(["updatePost", "publishPost"]);
  });

  it("deletes only after confirming", async () => {
    const api = editorApi({ deletePost: () => Effect.void });
    const { screen, props } = await renderEditor(existing, api);

    await screen.getByRole("button", { name: "Delete" }).click();
    const dialog = screen.getByRole("dialog");
    await expect
      .element(dialog.getByText(/“First post” will be gone/))
      .toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(api.callsTo("blogEditor", "deletePost")).toEqual([]);

    await screen.getByRole("button", { name: "Delete" }).click();
    await screen
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();

    await expect.poll(() => props.onDeleted.mock.calls.length).toBe(1);
    expect(api.callsTo("blogEditor", "deletePost")).toEqual([
      { params: { blog: "notes", postId: existing.id } },
    ]);
  });
});
