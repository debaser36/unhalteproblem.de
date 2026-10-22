import type { Blog, CategorySlug } from "@unhalteproblem.de/api";
import { DateTime, Order } from "effect";

/** The orders of the subblog list; it is small, so it is sorted here. */
export const blogSorts = {
  title: "Title A–Z",
  latest: "Latest post",
  posts: "Most posts",
  created: "Newest blog",
  category: "By category",
} as const;
export type BlogSort = keyof typeof blogSorts;

export const isBlogSort = (value: string | null): value is BlogSort =>
  value !== null && Object.hasOwn(blogSorts, value);

const byTitle = Order.mapInput(Order.String, (blog: Blog) =>
  blog.title.toLowerCase(),
);
const newestFirst = (time: (blog: Blog) => DateTime.Utc | null) =>
  Order.mapInput(Order.flip(Order.Number), (blog: Blog) => {
    const at = time(blog);
    // Blogs without posts last.
    return at === null ? Number.NEGATIVE_INFINITY : DateTime.toEpochMillis(at);
  });

const orders: Record<BlogSort, Order.Order<Blog>> = {
  title: byTitle,
  latest: Order.combine(
    newestFirst((blog) => blog.latestPostAt),
    byTitle,
  ),
  posts: Order.combine(
    Order.mapInput(Order.flip(Order.Number), (blog: Blog) => blog.postCount),
    byTitle,
  ),
  created: Order.combine(
    newestFirst((blog) => blog.createdAt),
    byTitle,
  ),
  category: Order.combine(
    Order.mapInput(Order.String, (blog: Blog) =>
      blog.categories.main.name.toLowerCase(),
    ),
    byTitle,
  ),
};

/**
 * The subblogs with `category` (as main or extra; all without one), in
 * the order of `sort`.
 */
export const sortBlogs = (
  blogs: ReadonlyArray<Blog>,
  sort: BlogSort,
  category: CategorySlug | undefined,
): ReadonlyArray<Blog> =>
  [...blogs]
    .filter(
      (blog) =>
        category === undefined ||
        blog.categories.main.slug === category ||
        blog.categories.extra.some(({ slug }) => slug === category),
    )
    .sort(orders[sort]);
