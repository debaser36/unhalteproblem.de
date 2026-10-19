import {
  Api,
  blogEditorRole,
  InvalidUpload,
  MediaTooLarge,
  PostNotFound,
} from "@unhalteproblem.de/api";
import { Array as Arr, Effect, Option, Stream } from "effect";
import { Multipart } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import * as Authorization from "#auth/Authorization";
import { BlogCommands } from "#domains/blogs/BlogCommands";
import { BlogQueries } from "#domains/blogs/BlogQueries";
import { noStore } from "./CacheControl.ts";
import {
  toManagedPost,
  toManagedPostListItem,
  toMediaInfo,
} from "./BlogViews.ts";

/** Too much was sent, or not a single well-formed file part. */
const uploadError = (error: Multipart.MultipartError) =>
  error.reason._tag === "FileTooLarge" ||
  error.reason._tag === "BodyTooLarge" ||
  error.reason._tag === "TooManyParts"
    ? new MediaTooLarge()
    : new InvalidUpload();

/** The bytes of the upload's file part `file`. */
const fileOf = (
  parts: Stream.Stream<Multipart.Part, Multipart.MultipartError>,
) =>
  Effect.gen(function* () {
    const files = yield* parts.pipe(
      Stream.filter(Multipart.isFile),
      Stream.filter((file) => file.key === "file"),
      Stream.take(1),
      Stream.runCollect,
    );
    const file = Arr.head(files);
    if (Option.isNone(file)) return yield* new InvalidUpload();
    return yield* file.value.contentEffect;
  }).pipe(
    Effect.catchTag("MultipartError", (error) =>
      Effect.fail(uploadError(error)),
    ),
  );

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
        ),
      )
      .handle("uploadMedia", ({ params, payload }) =>
        // The role is checked before a byte of the upload is read.
        Effect.flatMap(fileOf(payload), (bytes) =>
          commands.uploadImage(params.blog, bytes),
        ).pipe(Effect.map(toMediaInfo), asEditorOf(params.blog), noStore),
      );
  }),
);
