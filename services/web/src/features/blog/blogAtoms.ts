import type { BlogSlug, PostCursor, PostId, Tag } from "@unhalteproblem.de/api";
import { ApiClient } from "#api/ApiClient.ts";

/** Reactivity key of the subblog list (titles, post counts). */
export const blogsKey = "blogs";

/** Reactivity key of everything shown about one subblog's posts. */
export const blogKey = (blog: BlogSlug) => `blog/${blog}`;

/** Reactivity key of the feed across all subblogs. */
export const feedKey = "posts";

/** The keys a change to a post of `blog` makes stale. */
export const postChanged = (blog: BlogSlug) => [
  blogKey(blog),
  blogsKey,
  feedKey,
];

export const blogsAtom = ApiClient.query("blogs", "listBlogs", {
  reactivityKeys: [blogsKey],
  timeToLive: "5 minutes",
});

export const blogAtom = (blog: BlogSlug) =>
  ApiClient.query("blogs", "getBlog", {
    params: { blog },
    reactivityKeys: [blogsKey, blogKey(blog)],
  });

export interface PageRequest {
  readonly cursor: PostCursor | undefined;
  readonly tag: Tag | undefined;
  readonly limit?: number;
}

const pageQuery = ({ cursor, tag, limit = 10 }: PageRequest) => ({
  limit,
  ...(cursor === undefined ? {} : { cursor }),
  ...(tag === undefined ? {} : { tag }),
});

export const postPageAtom = (blog: BlogSlug, page: PageRequest) =>
  ApiClient.query("blogs", "listPosts", {
    params: { blog },
    query: pageQuery(page),
    reactivityKeys: [blogKey(blog)],
  });

export const recentPostsAtom = (page: PageRequest) =>
  ApiClient.query("blogs", "recentPosts", {
    query: pageQuery(page),
    reactivityKeys: [feedKey],
  });

export const postAtom = (blog: BlogSlug, post: string) =>
  ApiClient.query("blogs", "getPost", {
    params: { blog, post },
    reactivityKeys: [blogKey(blog)],
  });

export const managedPostsAtom = (blog: BlogSlug) =>
  ApiClient.query("blogEditor", "listManagedPosts", {
    params: { blog },
    reactivityKeys: [blogKey(blog)],
  });

export const managedPostAtom = (blog: BlogSlug, postId: PostId) =>
  ApiClient.query("blogEditor", "getManagedPost", {
    params: { blog, postId },
    reactivityKeys: [blogKey(blog)],
  });

export const createPost = ApiClient.mutation("blogEditor", "createPost");
export const updatePost = ApiClient.mutation("blogEditor", "updatePost");
export const publishPost = ApiClient.mutation("blogEditor", "publishPost");
export const unpublishPost = ApiClient.mutation("blogEditor", "unpublishPost");
export const deletePost = ApiClient.mutation("blogEditor", "deletePost");
export const uploadMedia = ApiClient.mutation("blogEditor", "uploadMedia");
