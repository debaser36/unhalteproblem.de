import {
  Authorized,
  blogEditorRole,
  type CreateBlogPayload,
  type PostInput,
  type UpdateBlogPayload,
} from "@unhalteproblem.de/api";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import { SqlError } from "effect/sql";
import * as Command from "#cqrs/Command";
import * as DomainEvent from "#cqrs/DomainEvent";
import { Transaction } from "#cqrs/Transaction";
import { blogScope, type StoredMedia } from "#domains/media/Media";
import { MediaCommands } from "#domains/media/MediaCommands";
import type { MediaTooLarge, UnsupportedMedia } from "#domains/media/Media";
import { UserDirectory } from "#domains/users/UserDirectory";
import {
  BlogCreated,
  BlogId,
  BlogNotFound,
  BlogRow,
  type BlogSlug,
  blogSlugConstraint,
  BlogSlugTaken,
  isStale,
  PostDeleted,
  PostEditConflict,
  PostId,
  PostNotFound,
  PostPublished,
  PostRow,
  PostSaved,
  postSlugConstraint,
  PostSlugTaken,
  PostUnpublished,
  publish,
} from "./Blog.ts";
import {
  BlogRepository,
  type BlogSummary,
  type PostView,
} from "./BlogRepository.ts";

/** Whether `error` is a violation of the unique constraint `constraint`. */
const violates =
  (constraint: string) =>
  (error: unknown): boolean =>
    SqlError.isSqlError(error) &&
    error.reason._tag === "UniqueViolation" &&
    error.reason.constraint === constraint;

/** The proof that the current user edits the subblog `blog`. */
const editorOf = (blog: BlogSlug) => Authorized(blogEditorRole(blog));

const make = Effect.gen(function* () {
  const repository = yield* BlogRepository;
  const users = yield* UserDirectory;
  const media = yield* MediaCommands;
  const transaction = yield* Transaction;

  /** Our id of the user behind a proof (the session's OIDC subject). */
  const actorOf = Effect.fnUntraced(function* (proof: {
    readonly user: { readonly id: string };
  }) {
    const user = yield* users.findBySubject(proof.user.id);
    if (Option.isNone(user)) {
      // Every session belongs to a user who has logged in since 0002.
      return yield* Effect.die(new Error("Editor without a user"));
    }
    return user.value.id;
  });

  const blogBySlug = Effect.fnUntraced(function* (blog: BlogSlug) {
    const row = yield* repository.findBlog(blog);
    if (Option.isNone(row)) return yield* new BlogNotFound({ blog });
    return row.value;
  });

  const summaryOf = Effect.fnUntraced(function* (blog: BlogSlug) {
    const summary = yield* repository.findSummary(blog);
    if (Option.isNone(summary)) {
      return yield* Effect.die(
        new Error("Blog vanished inside its transaction"),
      );
    }
    return summary.value;
  });

  /** The post of the subblog, locked until the transaction ends. */
  const lockPost = Effect.fnUntraced(function* (blog: BlogRow, postId: PostId) {
    const view = yield* repository.findPost(blog.id, postId, { lock: true });
    if (Option.isNone(view)) return yield* new PostNotFound({ post: postId });
    return view.value.post;
  });

  /** The post as it is now (with its author's name), after a change. */
  const viewOf = Effect.fnUntraced(function* (blog: BlogRow, postId: PostId) {
    const view = yield* repository.findPost(blog.id, postId);
    if (Option.isNone(view)) {
      return yield* Effect.die(
        new Error("Post vanished inside its transaction"),
      );
    }
    return view.value;
  });

  // A slug taken by someone else fails the statement; inside a savepoint
  // (a nested run) that rolls back only the statement, so the command can
  // answer with the domain error instead of a dead transaction.
  const savePost = (
    save: Effect.Effect<void, SqlError.SqlError>,
    slug: string,
  ) =>
    transaction
      .run(save)
      .pipe(
        Effect.catchIf(violates(postSlugConstraint), () =>
          Effect.fail(new PostSlugTaken({ slug })),
        ),
      );

  const setStatus = (published: boolean) =>
    Effect.fnUntraced(function* (blog: BlogSlug, postId: PostId) {
      const actor = yield* actorOf(yield* editorOf(blog));
      const blogRow = yield* blogBySlug(blog);
      const post = yield* lockPost(blogRow, postId);
      const now = yield* DateTime.now;
      if ((post.status === "published") !== published) {
        const changed = published
          ? publish(post, now)
          : PostRow.make({ ...post, status: "draft" });
        yield* repository.updatePost(
          PostRow.make({
            ...changed,
            updatedBy: Option.some(actor),
            updatedAt: now,
            version: post.version + 1,
          }),
        );
        yield* DomainEvent.record(
          published
            ? new PostPublished({ blog, postId, by: actor })
            : new PostUnpublished({ blog, postId, by: actor }),
        );
      }
      return yield* viewOf(blogRow, postId);
    });

  return BlogCommands.of({
    createBlog: Effect.fn("BlogCommands.createBlog")(function* (
      payload: CreateBlogPayload,
    ) {
      const actor = yield* actorOf(yield* Authorized("admin"));
      const now = yield* DateTime.now;
      yield* transaction
        .run(
          repository.insertBlog(
            BlogRow.make({
              id: BlogId.make(crypto.randomUUID()),
              slug: payload.slug,
              title: payload.title,
              description: payload.description,
              createdAt: now,
              createdBy: Option.some(actor),
              updatedAt: now,
            }),
          ),
        )
        .pipe(
          Effect.catchIf(violates(blogSlugConstraint), () =>
            Effect.fail(new BlogSlugTaken({ blog: payload.slug })),
          ),
        );
      yield* DomainEvent.record(
        new BlogCreated({ blog: payload.slug, by: actor }),
      );
      return yield* summaryOf(payload.slug);
    }, Command.boundary(transaction)),

    updateBlog: Effect.fn("BlogCommands.updateBlog")(function* (
      blog: BlogSlug,
      payload: UpdateBlogPayload,
    ) {
      yield* Authorized("admin");
      const row = yield* blogBySlug(blog);
      const now = yield* DateTime.now;
      yield* repository.updateBlog(
        BlogRow.make({ ...row, ...payload, updatedAt: now }),
      );
      return yield* summaryOf(blog);
    }, Command.boundary(transaction)),

    createPost: Effect.fn("BlogCommands.createPost")(function* (
      blog: BlogSlug,
      input: PostInput,
    ) {
      const actor = yield* actorOf(yield* editorOf(blog));
      const blogRow = yield* blogBySlug(blog);
      const now = yield* DateTime.now;
      const id = PostId.make(crypto.randomUUID());
      yield* savePost(
        repository.insertPost(
          PostRow.make({
            id,
            blogId: blogRow.id,
            slug: input.slug,
            title: input.title,
            summary: input.summary,
            tags: input.tags,
            coverMediaId: Option.fromNullOr(input.coverImage),
            content: input.content,
            status: "draft",
            publishedAt: Option.none(),
            authorId: Option.some(actor),
            updatedBy: Option.some(actor),
            createdAt: now,
            updatedAt: now,
            version: 1,
          }),
        ),
        input.slug,
      );
      yield* DomainEvent.record(
        new PostSaved({ blog, postId: id, version: 1, by: actor }),
      );
      return yield* viewOf(blogRow, id);
    }, Command.boundary(transaction)),

    updatePost: Effect.fn("BlogCommands.updatePost")(function* (
      blog: BlogSlug,
      postId: PostId,
      input: PostInput,
      version: number,
    ) {
      const actor = yield* actorOf(yield* editorOf(blog));
      const blogRow = yield* blogBySlug(blog);
      const post = yield* lockPost(blogRow, postId);
      if (isStale(post, version)) {
        return yield* new PostEditConflict({ currentVersion: post.version });
      }
      const now = yield* DateTime.now;
      const next = post.version + 1;
      yield* savePost(
        repository.updatePost(
          PostRow.make({
            ...post,
            slug: input.slug,
            title: input.title,
            summary: input.summary,
            tags: input.tags,
            coverMediaId: Option.fromNullOr(input.coverImage),
            content: input.content,
            updatedBy: Option.some(actor),
            updatedAt: now,
            version: next,
          }),
        ),
        input.slug,
      );
      yield* DomainEvent.record(
        new PostSaved({ blog, postId, version: next, by: actor }),
      );
      return yield* viewOf(blogRow, postId);
    }, Command.boundary(transaction)),

    publishPost: Effect.fn("BlogCommands.publishPost")(
      setStatus(true),
      Command.boundary(transaction),
    ),

    unpublishPost: Effect.fn("BlogCommands.unpublishPost")(
      setStatus(false),
      Command.boundary(transaction),
    ),

    deletePost: Effect.fn("BlogCommands.deletePost")(function* (
      blog: BlogSlug,
      postId: PostId,
    ) {
      const actor = yield* actorOf(yield* editorOf(blog));
      const blogRow = yield* blogBySlug(blog);
      yield* lockPost(blogRow, postId);
      yield* repository.deletePost(postId);
      yield* DomainEvent.record(new PostDeleted({ blog, postId, by: actor }));
    }, Command.boundary(transaction)),

    uploadImage: Effect.fn("BlogCommands.uploadImage")(function* (
      blog: BlogSlug,
      bytes: Uint8Array,
    ) {
      const actor = yield* actorOf(yield* editorOf(blog));
      return yield* media.store({
        scope: blogScope(blog),
        bytes,
        uploadedBy: actor,
      });
    }, Command.boundary(transaction)),
  });
});

/** An editor's proof for some subblog; each method checks it is for the one it acts on. */
type EditorProof = Authorized<`blogEditor:${string}`>;

/**
 * The commands of the blogs domain. Subblogs are created and changed by
 * admins (`Authorized("admin")`); the posts of subblog `<slug>` by the
 * holders of `blogEditor:<slug>`, whose proof each method requires for the
 * subblog it is given (a proof for another subblog is missing at runtime:
 * the request is refused, never let through).
 */
export class BlogCommands extends Context.Service<
  BlogCommands,
  {
    readonly createBlog: (
      payload: CreateBlogPayload,
    ) => Effect.Effect<BlogSummary, BlogSlugTaken, Authorized<"admin">>;
    readonly updateBlog: (
      blog: BlogSlug,
      payload: UpdateBlogPayload,
    ) => Effect.Effect<BlogSummary, BlogNotFound, Authorized<"admin">>;
    /** Creates a draft. */
    readonly createPost: (
      blog: BlogSlug,
      input: PostInput,
    ) => Effect.Effect<PostView, BlogNotFound | PostSlugTaken, EditorProof>;
    /** Saves an edit made from `version`; fails if someone saved in between. */
    readonly updatePost: (
      blog: BlogSlug,
      postId: PostId,
      input: PostInput,
      version: number,
    ) => Effect.Effect<
      PostView,
      BlogNotFound | PostNotFound | PostSlugTaken | PostEditConflict,
      EditorProof
    >;
    /** Makes the post public; keeps the time of its first publication. */
    readonly publishPost: (
      blog: BlogSlug,
      postId: PostId,
    ) => Effect.Effect<PostView, BlogNotFound | PostNotFound, EditorProof>;
    /** Makes the post a draft again. */
    readonly unpublishPost: (
      blog: BlogSlug,
      postId: PostId,
    ) => Effect.Effect<PostView, BlogNotFound | PostNotFound, EditorProof>;
    readonly deletePost: (
      blog: BlogSlug,
      postId: PostId,
    ) => Effect.Effect<void, BlogNotFound | PostNotFound, EditorProof>;
    /** Stores an image for the subblog's posts. */
    readonly uploadImage: (
      blog: BlogSlug,
      bytes: Uint8Array,
    ) => Effect.Effect<
      StoredMedia,
      MediaTooLarge | UnsupportedMedia,
      EditorProof
    >;
  }
>()("@unhalteproblem.de/backend/domains/blogs/BlogCommands") {
  /** Needs `BlogRepository`, `UserDirectory`, `MediaCommands` and `Transaction`. */
  static readonly layer = Layer.effect(BlogCommands, make);
}
