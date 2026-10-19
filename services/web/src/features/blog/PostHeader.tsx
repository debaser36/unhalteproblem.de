import {
  type BlogSlug,
  mediaUrl,
  type MediaId,
  type PostAuthor,
} from "@unhalteproblem.de/api";
import type { DateTime } from "effect";
import { Clock } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { formatDate, isoDate } from "#lib/format.ts";
import { Badge } from "#ui/Badge.tsx";

/**
 * The top of a post: where it lives, when and by whom, title, summary and
 * cover. Shared by the reader's view and the editor, so editing in place
 * keeps the page's look; the editor passes inputs as `title`/`summary`.
 */
export function PostHeader({
  blog,
  title,
  summary,
  tags,
  coverImage,
  publishedAt,
  readingMinutes,
  author,
  aside,
}: {
  readonly blog: BlogSlug;
  readonly title: ReactNode;
  readonly summary: ReactNode;
  readonly tags: ReadonlyArray<string>;
  readonly coverImage: MediaId | null;
  readonly publishedAt: DateTime.Utc | null;
  readonly readingMinutes?: number;
  readonly author: PostAuthor;
  /** Controls next to the meta line (edit button, status). */
  readonly aside?: ReactNode;
}) {
  return (
    <header className="space-y-6 pt-10 pb-8 sm:pt-14">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm text-muted">
          <Link to={`/blog/${blog}`} className="text-accent-2 hover:underline">
            ~/blog/{blog}
          </Link>
          {publishedAt !== null && (
            <time dateTime={isoDate(publishedAt)}>
              {formatDate(publishedAt)}
            </time>
          )}
          {readingMinutes !== undefined && readingMinutes > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock size={13} /> {readingMinutes} min read
            </span>
          )}
          {author.name !== null && <span>by {author.name}</span>}
        </p>
        {aside}
      </div>
      {title}
      {summary}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Link key={tag} to={`/blog/${blog}?tag=${tag}`}>
              <Badge className="hover:border-accent/50 hover:text-accent">
                #{tag}
              </Badge>
            </Link>
          ))}
        </div>
      )}
      {coverImage !== null && (
        <img
          src={mediaUrl(coverImage)}
          alt=""
          className="mt-4 aspect-[2/1] w-full rounded-xl border border-border object-cover"
        />
      )}
    </header>
  );
}
