import {
  Authorized,
  blogEditorRole,
  type CategoriesInput,
  type CreateBlogPayload,
  type PostInput,
  type UpdateBlogPayload,
} from "@unhalteproblem.de/api";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import type { SqlError } from "effect/sql";
import * as Command from "#cqrs/Command";
import * as DomainEvent from "#cqrs/DomainEvent";
import { Transaction } from "#cqrs/Transaction";
import { AuditCommands } from "#domains/audit/AuditCommands";
import { blogScope, type StoredMedia } from "#domains/media/Media";
import { MediaCommands } from "#domains/media/MediaCommands";
import type {
  InvalidUpload,
  MediaTooLarge,
  UnsupportedMedia,
} from "#domains/media/Media";
import { actorIdOf, UserDirectory } from "#domains/users/UserDirectory";
import type { UserId } from "#domains/users/User";
import { isUniqueViolation } from "#repositories/Columns";
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
import { namedCategories } from "./Category.ts";
import { CategoryRepository } from "./CategoryRepository.ts";

/** The proof that the current user edits the subblog `blog`. */
const editorOf = (blog: BlogSlug) => Authorized(blogEditorRole(blog));

const make = Effect.gen(function* () {
  const repository = yield* BlogRepository;
  const categories = yield* CategoryRepository;
  const users = yield* UserDirectory;
  const media = yield* MediaCommands;
  const audit = yield* AuditCommands;
  const transaction = yield* Transaction;

  const actorOf = (proof: { readonly user: { readonly id: string } }) =>
    actorIdOf(proof).pipe(Effect.provideService(UserDirectory, users));

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
        Effect.catchIf(isUniqueViolation(postSlugConstraint), () =>
          Effect.fail(new PostSlugTaken({ slug })),
        ),
      );

  /**
   * The ids of the chosen categories, main first, creating the new ones on
   * behalf of `actor`; each new one is recorded in the audit log.
   */
  const chooseCategories = Effect.fnUntraced(function* (
    input: CategoriesInput,
    actor: UserId,
    now: DateTime.Utc,
  ) {
    const { ids, created } = yield* categories.ensure(
      namedCategories(input),
      Option.some(actor),
      now,
    );
    for (const slug of created) {
      yield* audit.record({
        action: "category_created",
        actor: Option.some(actor),
        target: Option.none(),
        detail: slug,
      });
    }
    const [main, ...extra] = ids;
    if (main === undefined) {
      return yield* Effect.die(new Error("A main category is required"));
    }
    return { main, extra };
  });

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
      const chosen = yield* chooseCategories(payload.categories, actor, now);
      const id = BlogId.make(crypto.randomUUID());
      yield* transaction
        .run(
          repository.insertBlog(
            BlogRow.make({
              id,
              slug: payload.slug,
              title: payload.title,
              description: payload.description,
              mainCategoryId: chosen.main,
              createdAt: now,
              createdBy: Option.some(actor),
              updatedAt: now,
            }),
          ),
        )
        .pipe(
          Effect.catchIf(isUniqueViolation(blogSlugConstraint), () =>
            Effect.fail(new BlogSlugTaken({ blog: payload.slug })),
          ),
        );
      yield* categories.setBlogExtras(id, chosen.extra);
      yield* DomainEvent.record(
        new BlogCreated({ blog: payload.slug, by: actor }),
      );
      yield* audit.record({
        action: "blog_created",
        actor: Option.some(actor),
        target: Option.none(),
        detail: payload.slug,
      });
      return yield* summaryOf(payload.slug);
    }, Command.boundary(transaction)),

    updateBlog: Effect.fn("BlogCommands.updateBlog")(function* (
      blog: BlogSlug,
      payload: UpdateBlogPayload,
    ) {
      const actor = yield* actorOf(yield* Authorized("admin"));
      const row = yield* blogBySlug(blog);
      const now = yield* DateTime.now;
      yield* repository.updateBlog(
        BlogRow.make({ ...row, ...payload, updatedAt: now }),
      );
      yield* audit.record({
        action: "blog_updated",
        actor: Option.some(actor),
        target: Option.none(),
        detail: blog,
      });
      return yield* summaryOf(blog);
    }, Command.boundary(transaction)),

    setBlogCategories: Effect.fn("BlogCommands.setBlogCategories")(function* (
      blog: BlogSlug,
      input: CategoriesInput,
    ) {
      const actor = yield* actorOf(yield* editorOf(blog));
      const row = yield* blogBySlug(blog);
      const now = yield* DateTime.now;
      const chosen = yield* chooseCategories(input, actor, now);
      yield* categories.setBlogMain(row.id, chosen.main, now);
      yield* categories.setBlogExtras(row.id, chosen.extra);
      yield* audit.record({
        action: "blog_updated",
        actor: Option.some(actor),
        target: Option.none(),
        detail: blog,
      });
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
      const chosen = yield* chooseCategories(input.categories, actor, now);
      yield* savePost(
        repository.insertPost(
          PostRow.make({
            id,
            blogId: blogRow.id,
            slug: input.slug,
            title: input.title,
            summary: input.summary,
            tags: input.tags,
            mainCategoryId: chosen.main,
            coverMediaId: Option.fromNullOr(input.coverImage),
            content: input.content,
            status: "draft",
            publishedAt: Option.none(),
            authorId: Option.some(actor),
            updatedBy: Option.some(actor),
            createdAt: now,
            updatedAt: now,
            version: 1,
            // Counted by the database from the content.
            wordCount: 0,
          }),
        ),
        input.slug,
      );
      yield* categories.setPostExtras(id, chosen.extra);
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
      const now = yield* DateTime.now;
      // Categories before the post: an admin's merge locks them first too,
      // so the two never deadlock. A stale version rolls them back.
      const chosen = yield* chooseCategories(input.categories, actor, now);
      const post = yield* lockPost(blogRow, postId);
      if (isStale(post, version)) {
        return yield* new PostEditConflict({ currentVersion: post.version });
      }
      const next = post.version + 1;
      yield* savePost(
        repository.updatePost(
          PostRow.make({
            ...post,
            slug: input.slug,
            title: input.title,
            summary: input.summary,
            tags: input.tags,
            mainCategoryId: chosen.main,
            coverMediaId: Option.fromNullOr(input.coverImage),
            content: input.content,
            updatedBy: Option.some(actor),
            updatedAt: now,
            version: next,
          }),
        ),
        input.slug,
      );
      yield* categories.setPostExtras(postId, chosen.extra);
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
      yield* audit.record({
        action: "post_deleted",
        actor: Option.some(actor),
        target: Option.none(),
        detail: postId,
      });
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
    /** Replaces the subblog's categories; for its editors, not only admins. */
    readonly setBlogCategories: (
      blog: BlogSlug,
      input: CategoriesInput,
    ) => Effect.Effect<BlogSummary, BlogNotFound, EditorProof>;
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
      InvalidUpload | MediaTooLarge | UnsupportedMedia,
      EditorProof
    >;
  }
>()("@unhalteproblem.de/backend/domains/blogs/BlogCommands") {
  /** Needs `BlogRepository`, `CategoryRepository`, `UserDirectory`, `MediaCommands`, `AuditCommands` and `Transaction`. */
  static readonly layer = Layer.effect(BlogCommands, make);
}
