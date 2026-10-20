import { Api, type BlogSlug, type PostPageQuery } from "@unhalteproblem.de/api";
import { Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { BlogQueries } from "#domains/blogs/BlogQueries";
import { revalidate } from "./CacheControl.ts";
import { toBlog, toPostListItem, toPublishedPost } from "./BlogViews.ts";

/** The public blog: subblogs and their published posts. */
export const BlogsHandlers = HttpApiBuilder.group(
  Api,
  "blogs",
  Effect.fn(function* (handlers) {
    const queries = yield* BlogQueries;
    const feed = (blog: Option.Option<BlogSlug>, query: PostPageQuery) =>
      queries
        .feed({
          blog,
          tag: Option.fromUndefinedOr(query.tag),
          after: Option.fromUndefinedOr(query.cursor),
          limit: query.limit,
        })
        .pipe(
          Effect.map(({ posts, next }) => ({
            posts: posts.map(toPostListItem),
            nextCursor: Option.getOrNull(next),
          })),
          revalidate,
        );
    return handlers
      .handle("listBlogs", () =>
        queries.listBlogs.pipe(
          Effect.map((blogs) => blogs.map(toBlog)),
          revalidate,
        ),
      )
      .handle("getBlog", ({ params }) =>
        queries.getBlog(params.blog).pipe(Effect.map(toBlog), revalidate),
      )
      .handle("listPosts", ({ params, query }) =>
        feed(Option.some(params.blog), query),
      )
      .handle("recentPosts", ({ query }) =>
        // Without a subblog there is none to miss.
        feed(Option.none(), query).pipe(
          Effect.catchTag("BlogNotFound", Effect.die),
        ),
      )
      .handle("getPost", ({ params }) =>
        queries
          .getPublished(params.blog, params.post)
          .pipe(Effect.map(toPublishedPost), revalidate),
      );
  }),
);
