import { Api, blogEditorRole, PostNotFound } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import * as Authorization from "#auth/Authorization";
import { BlogCommands } from "#domains/blogs/BlogCommands";
import { BlogQueries } from "#domains/blogs/BlogQueries";
import { noStore } from "./CacheControl.ts";
import { uploadedFile } from "./Upload.ts";
import {
  toManagedPost,
  toManagedPostListItem,
  toMediaInfo,
} from "./BlogViews.ts";

/**
 * Writing in place: the posts of subblog `:blog`, drafts included, for the
 * holders of `blogEditor:<blog>`. Each handler checks that role for the
 * subblog in its path (403 otherwise), which provides the proof the
 * commands and queries require; the group's `Authentication` has resolved
 * the session first (401 without one).
 */
export const BlogEditorHandlers = HttpApiBuilder.group(
  Api,
  "blogEditor",
  Effect.fn(function* (handlers) {
    const commands = yield* BlogCommands;
    const queries = yield* BlogQueries;
    const asEditorOf = (blog: string) =>
      Authorization.provide(blogEditorRole(blog));
    return handlers
      .handle("listManagedPosts", ({ params }) =>
        queries.listManaged(params.blog).pipe(
          Effect.map((views) => views.map(toManagedPostListItem)),
          // An unknown subblog has no editors: treat it like no access.
          Effect.catchTag("BlogNotFound", () => Effect.succeed([])),
          asEditorOf(params.blog),
          noStore,
        ),
      )
      .handle("getManagedPost", ({ params }) =>
        queries.getManaged(params.blog, params.postId).pipe(
          Effect.map(toManagedPost),
          Effect.catchTag("BlogNotFound", () =>
            Effect.fail(new PostNotFound({ post: params.postId })),
          ),
          asEditorOf(params.blog),
          noStore,
        ),
      )
      .handle("createPost", ({ params, payload }) =>
        commands
          .createPost(params.blog, payload)
          .pipe(Effect.map(toManagedPost), asEditorOf(params.blog), noStore),
      )
      .handle("updatePost", ({ params, payload: { version, ...input } }) =>
        commands.updatePost(params.blog, params.postId, input, version).pipe(
          Effect.map(toManagedPost),
          Effect.catchTag("BlogNotFound", () =>
            Effect.fail(new PostNotFound({ post: params.postId })),
          ),
          asEditorOf(params.blog),
          noStore,
        ),
      )
      .handle("publishPost", ({ params }) =>
        commands.publishPost(params.blog, params.postId).pipe(
          Effect.map(toManagedPost),
          Effect.catchTag("BlogNotFound", () =>
            Effect.fail(new PostNotFound({ post: params.postId })),
          ),
          asEditorOf(params.blog),
          noStore,
        ),
      )
      .handle("unpublishPost", ({ params }) =>
        commands.unpublishPost(params.blog, params.postId).pipe(
          Effect.map(toManagedPost),
          Effect.catchTag("BlogNotFound", () =>
            Effect.fail(new PostNotFound({ post: params.postId })),
          ),
          asEditorOf(params.blog),
          noStore,
        ),
      )
      .handle("deletePost", ({ params }) =>
        commands.deletePost(params.blog, params.postId).pipe(
          Effect.catchTag("BlogNotFound", () =>
            Effect.fail(new PostNotFound({ post: params.postId })),
          ),
          asEditorOf(params.blog),
          noStore,
        ),
      )
      .handle("uploadMedia", ({ params, payload }) =>
        // The role is checked before a byte of the upload is read.
        Effect.flatMap(uploadedFile(payload), (bytes) =>
          commands.uploadImage(params.blog, bytes),
        ).pipe(Effect.map(toMediaInfo), asEditorOf(params.blog), noStore),
      );
  }),
);
