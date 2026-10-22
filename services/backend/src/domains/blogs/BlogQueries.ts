import {
  Authorized,
  blogEditorRole,
  type PostCursorPosition,
  type PostSort,
} from "@unhalteproblem.de/api";
import { Context, Effect, Layer, Option } from "effect";
import * as Query from "#cqrs/Query";
import {
  BlogNotFound,
  type BlogSlug,
  type PostId,
  PostNotFound,
  type PostSlug,
} from "./Blog.ts";
import {
  BlogRepository,
  type BlogSummary,
  type FeedQuery,
  type PostListView,
  type PostView,
} from "./BlogRepository.ts";

export interface FeedPage {
  readonly posts: ReadonlyArray<PostListView>;
  /** Where the next page starts; none on the last page. */
  readonly next: Option.Option<PostCursorPosition>;
}

/** What a reader asks a feed for: like `FeedQuery`, by subblog slug. */
export interface FeedRequest extends Omit<FeedQuery, "blogId"> {
  readonly blog: Option.Option<BlogSlug>;
}

/** The position of `view` in the order of `sort`, for the next cursor. */
const positionOf = (
  sort: PostSort,
  { post, categories, authorName }: PostListView,
): PostCursorPosition => {
  const id = post.id;
  // Feeds list only published posts, and those always have the time.
  const publishedAt = Option.getOrElse(post.publishedAt, () => post.updatedAt);
  switch (sort) {
    case "newest":
    case "oldest":
      return { sort, publishedAt, id };
    case "updated":
      return { sort, updatedAt: post.updatedAt, id };
    case "title":
      return { sort, title: post.title, id };
    case "readingTime":
      return { sort, words: post.wordCount, id };
    case "category":
      return { sort, category: categories.main.name, publishedAt, id };
    case "author":
      return { sort, author: Option.getOrNull(authorName), publishedAt, id };
  }
};

const make = Effect.gen(function* () {
  const repository = yield* BlogRepository;

  const blogId = Effect.fnUntraced(function* (blog: BlogSlug) {
    const row = yield* repository.findBlog(blog);
    if (Option.isNone(row)) return yield* new BlogNotFound({ blog });
    return row.value.id;
  });

  /** One more than asked tells whether there is a next page. */
  const page = Effect.fnUntraced(function* (query: FeedQuery) {
    const views = yield* repository.feed({ ...query, limit: query.limit + 1 });
    const posts = views.slice(0, query.limit);
    const last = posts.at(-1);
    return {
      posts,
      next:
        views.length > query.limit && last !== undefined
          ? Option.some(positionOf(query.sort, last))
          : Option.none(),
    } satisfies FeedPage;
  });

  return BlogQueries.of({
    listBlogs: repository.listSummaries.pipe(
      Query.boundary,
      Effect.withSpan("BlogQueries.listBlogs"),
    ),

    getBlog: Effect.fn("BlogQueries.getBlog")(function* (blog: BlogSlug) {
      const summary = yield* repository.findSummary(blog);
      if (Option.isNone(summary)) return yield* new BlogNotFound({ blog });
      return summary.value;
    }, Query.boundary),

    feed: Effect.fn("BlogQueries.feed")(function* ({
      blog,
      ...query
    }: FeedRequest) {
      const id = Option.isSome(blog)
        ? Option.some(yield* blogId(blog.value))
        : Option.none();
      return yield* page({ ...query, blogId: id });
    }, Query.boundary),

    getPublished: Effect.fn("BlogQueries.getPublished")(function* (
      blog: BlogSlug,
      slug: PostSlug,
    ) {
      const view = yield* repository.findPublished(yield* blogId(blog), slug);
      if (Option.isNone(view)) return yield* new PostNotFound({ post: slug });
      return view.value;
    }, Query.boundary),

    listManaged: Effect.fn("BlogQueries.listManaged")(function* (
      blog: BlogSlug,
    ) {
      yield* Authorized(blogEditorRole(blog));
      return yield* repository.listOfBlog(yield* blogId(blog));
    }, Query.boundary),

    getManaged: Effect.fn("BlogQueries.getManaged")(function* (
      blog: BlogSlug,
      postId: PostId,
    ) {
      yield* Authorized(blogEditorRole(blog));
      const view = yield* repository.findPost(yield* blogId(blog), postId);
      if (Option.isNone(view)) return yield* new PostNotFound({ post: postId });
      return view.value;
    }, Query.boundary),
  });
});

type EditorProof = Authorized<`blogEditor:${string}`>;

/**
 * The reads of the blogs domain: published posts for everyone, every post
 * (drafts included) for the editors of the subblog.
 */
export class BlogQueries extends Context.Service<
  BlogQueries,
  {
    readonly listBlogs: Effect.Effect<ReadonlyArray<BlogSummary>>;
    readonly getBlog: (
      blog: BlogSlug,
    ) => Effect.Effect<BlogSummary, BlogNotFound>;
    /**
     * Published posts in the order the request asks for: of one subblog,
     * or of all.
     */
    readonly feed: (
      request: FeedRequest,
    ) => Effect.Effect<FeedPage, BlogNotFound>;
    readonly getPublished: (
      blog: BlogSlug,
      slug: PostSlug,
    ) => Effect.Effect<PostView, BlogNotFound | PostNotFound>;
    /** Every post of the subblog, drafts included; for its editors. */
    readonly listManaged: (
      blog: BlogSlug,
    ) => Effect.Effect<ReadonlyArray<PostListView>, BlogNotFound, EditorProof>;
    readonly getManaged: (
      blog: BlogSlug,
      postId: PostId,
    ) => Effect.Effect<PostView, BlogNotFound | PostNotFound, EditorProof>;
  }
>()("@unhalteproblem.de/backend/domains/blogs/BlogQueries") {
  /** Needs `BlogRepository`. */
  static readonly layer = Layer.effect(BlogQueries, make);
}
