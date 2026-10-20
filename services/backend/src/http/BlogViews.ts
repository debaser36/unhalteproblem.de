import type {
  Blog,
  ManagedPost,
  ManagedPostListItem,
  MediaInfo,
  PostListItem,
  PublishedPost,
} from "@unhalteproblem.de/api";
import { mediaUrl } from "@unhalteproblem.de/api";
import { Option } from "effect";
import { readingMinutes } from "#domains/blogs/Blog";
import type {
  BlogSummary,
  PostListView,
  PostView,
} from "#domains/blogs/BlogRepository";
import type { StoredMedia } from "#domains/media/Media";

// Translations from the blogs and media domains to the contract.

export const toBlog = (summary: BlogSummary): Blog => summary;

export const toPostListItem = ({
  post,
  blog,
  authorName,
  words,
}: PostListView): PostListItem => ({
  id: post.id,
  blog,
  slug: post.slug,
  title: post.title,
  summary: post.summary,
  tags: post.tags,
  coverImage: Option.getOrNull(post.coverMediaId),
  // Only published posts are listed, and those always have the time.
  publishedAt: Option.getOrElse(post.publishedAt, () => post.updatedAt),
  updatedAt: post.updatedAt,
  author: { name: Option.getOrNull(authorName) },
  readingMinutes: readingMinutes(words),
});

export const toPublishedPost = (view: PostView): PublishedPost => ({
  ...toPostListItem(view),
  content: view.post.content,
});

export const toManagedPostListItem = ({
  post,
  blog,
  authorName,
}: PostListView): ManagedPostListItem => ({
  id: post.id,
  blog,
  slug: post.slug,
  title: post.title,
  summary: post.summary,
  tags: post.tags,
  coverImage: Option.getOrNull(post.coverMediaId),
  status: post.status,
  publishedAt: Option.getOrNull(post.publishedAt),
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
  version: post.version,
  author: { name: Option.getOrNull(authorName) },
});

export const toManagedPost = (view: PostView): ManagedPost => ({
  ...toManagedPostListItem(view),
  content: view.post.content,
});

export const toMediaInfo = (media: StoredMedia): MediaInfo => ({
  id: media.id,
  url: mediaUrl(media.id),
  contentType: media.contentType,
  byteSize: media.byteSize,
  uploadedAt: media.uploadedAt,
});
