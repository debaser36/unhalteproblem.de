import { assert, describe, it } from "@effect/vitest";
import { emptyDocument } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { makeBlogApp, postInput } from "#testing/Blogs";

/** The audit entries of `actions`, oldest first. */
const entries = (
  app: Effect.Success<ReturnType<typeof makeBlogApp>>,
  actions: ReadonlyArray<string>,
) =>
  app.sql(
    (sql) => sql<{
      readonly action: string;
      readonly actorId: string | null;
      readonly targetId: string | null;
      readonly detail: string | null;
    }>`
      SELECT action, actor_id, target_id, detail FROM audit_log
      WHERE ${sql.in("action", actions)}
      ORDER BY id
    `,
  );

const project = (slug: string) => ({
  slug,
  title: "A project",
  summary: "",
  tags: [],
  status: "active",
  featured: false,
  position: 0,
  repoUrl: null,
  liveUrl: null,
  coverImage: null,
  content: emptyDocument,
  published: false,
});

describe("audit trail of content changes", () => {
  it.effect("records blogs created and renamed, with the slug", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      yield* app.createBlog("alpha");
      yield* app.expect(200, app.admin.cookie, "PATCH", "/admin/blogs/alpha", {
        body: { title: "Alpha", description: "" },
      });
      assert.deepStrictEqual(
        yield* entries(app, ["blog_created", "blog_updated"]),
        [
          {
            action: "blog_created",
            actorId: app.admin.id,
            targetId: null,
            detail: "alpha",
          },
          {
            action: "blog_updated",
            actorId: app.admin.id,
            targetId: null,
            detail: "alpha",
          },
        ],
      );
    }),
  );

  it.effect(
    "records deleted posts, with the post id, and nothing else of posts",
    () =>
      Effect.gen(function* () {
        const app = yield* makeBlogApp();
        yield* app.createBlog("alpha");
        const editor = yield* app.editor("ed", "alpha");
        const post = yield* app.createPost(
          editor.cookie,
          "alpha",
          postInput("first"),
        );
        const id = String(post["id"]);
        yield* app.expect(
          200,
          editor.cookie,
          "POST",
          `/blogs/alpha/manage/posts/${id}/publish`,
        );
        yield* app.expect(
          204,
          editor.cookie,
          "DELETE",
          `/blogs/alpha/manage/posts/${id}`,
        );
        assert.deepStrictEqual(yield* entries(app, ["post_deleted"]), [
          {
            action: "post_deleted",
            actorId: editor.id,
            targetId: null,
            detail: id,
          },
        ]);
      }),
  );

  it.effect(
    "records projects created, updated and deleted, with the slug",
    () =>
      Effect.gen(function* () {
        const app = yield* makeBlogApp();
        const created = yield* app.expect(
          201,
          app.admin.cookie,
          "POST",
          "/admin/projects",
          {
            body: project("tool"),
          },
        );
        const id = String(created["id"]);
        yield* app.expect(
          200,
          app.admin.cookie,
          "PUT",
          `/admin/projects/${id}`,
          {
            body: { ...project("tool-v2"), version: 1 },
          },
        );
        yield* app.expect(
          204,
          app.admin.cookie,
          "DELETE",
          `/admin/projects/${id}`,
        );
        const by = app.admin.id;
        assert.deepStrictEqual(
          yield* entries(app, [
            "project_created",
            "project_updated",
            "project_deleted",
          ]),
          [
            {
              action: "project_created",
              actorId: by,
              targetId: null,
              detail: "tool",
            },
            {
              action: "project_updated",
              actorId: by,
              targetId: null,
              detail: "tool-v2",
            },
            {
              action: "project_deleted",
              actorId: by,
              targetId: null,
              detail: "tool-v2",
            },
          ],
        );
      }),
  );

  it.effect("a refused change leaves no entry", () =>
    Effect.gen(function* () {
      const app = yield* makeBlogApp();
      yield* app.createBlog("alpha");
      // The slug is taken: the command fails, its audit entry rolls back.
      yield* app.expect(409, app.admin.cookie, "POST", "/admin/blogs", {
        body: { slug: "alpha", title: "Again", description: "" },
      });
      assert.lengthOf(yield* entries(app, ["blog_created"]), 1);
    }),
  );
});
