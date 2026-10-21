import { ApiClient } from "#api/ApiClient.ts";

/** Reactivity key of everything that shows blog requests. */
export const blogRequestsKey = "blog-requests";

/** The logged-in user's own requests, newest first. */
export const myBlogRequestsAtom = ApiClient.query(
  "blogRequests",
  "listMyBlogRequests",
  { reactivityKeys: [blogRequestsKey] },
);

export const requestBlog = ApiClient.mutation("blogRequests", "requestBlog");
export const withdrawBlogRequest = ApiClient.mutation(
  "blogRequests",
  "withdrawBlogRequest",
);
