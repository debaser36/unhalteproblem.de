import {
  Blog,
  BlogSlug,
  PostPage,
  PostPageQuery,
  PostSlug,
  PublishedPost,
} from "#domain/Blog";
import { BlogNotFound } from "#errors/BlogNotFound";
import { PostNotFound } from "#errors/PostNotFound";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";

/** Path parameters of the endpoints for one subblog. */
const BlogParams = { blog: BlogSlug };

// Shared by the paged post lists.
const pagingDescription =
  "Newest first (by `publishedAt`, then `id`), paged by cursor: " +
  "`nextCursor` is the position after the last returned post (null on the " +
  "last page); pass it as `cursor` to get the next page. `limit` is 1 to " +
  "50 (default 10); `tag` keeps only posts with that tag. A malformed " +
  "`cursor` is rejected with 400.";

/**
 * The public, read-only side of the subblogs: the blogs and their published
 * posts. Drafts never appear here.
 *
 * Public on purpose (no `Authentication`): the blogs are the website's
 * public content, read by anonymous visitors. Every endpoint is a GET that
 * only returns published data, so there is nothing to protect.
 */
export class BlogsGroup extends HttpApiGroup.make("blogs")
  .add(
    HttpApiEndpoint.get("listBlogs", "/blogs", {
      success: Schema.Array(Blog).annotate({
        description: "All subblogs, ordered by title.",
      }),
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List the subblogs",
        description:
          "Public. Returns every subblog with the number of its published " +
          "posts and the time of the newest one.",
      }),
    ),
    HttpApiEndpoint.get("getBlog", "/blogs/:blog", {
      params: BlogParams,
      success: Blog,
      error: BlogNotFound,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get a subblog",
        description:
          "Public. Returns the subblog; 404 `BlogNotFound` for an unknown " +
          "slug.",
      }),
    ),
    HttpApiEndpoint.get("listPosts", "/blogs/:blog/posts", {
      params: BlogParams,
      query: PostPageQuery,
      success: PostPage,
      error: BlogNotFound,
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List the posts of a subblog",
        description:
          "Public. Returns one page of the subblog's published posts, " +
          "without content. " +
          pagingDescription +
          " Answers 404 `BlogNotFound` for an unknown slug.",
      }),
    ),
    HttpApiEndpoint.get("getPost", "/blogs/:blog/posts/:post", {
      params: { blog: BlogSlug, post: PostSlug },
      success: PublishedPost,
      error: [BlogNotFound, PostNotFound],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "Get a published post",
        description:
          "Public. Returns the published post with this slug and its " +
          "content. Answers 404 `BlogNotFound` for an unknown subblog and " +
          "404 `PostNotFound` for an unknown slug or a draft.",
      }),
    ),
    HttpApiEndpoint.get("recentPosts", "/posts", {
      query: PostPageQuery,
      success: PostPage,
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List the posts of all subblogs",
        description:
          "Public. Returns one page of the published posts of every " +
          "subblog together, without content. " +
          pagingDescription,
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Blogs",
      description:
        "The subblogs and their published posts, readable by everyone.",
    }),
  ) {}
