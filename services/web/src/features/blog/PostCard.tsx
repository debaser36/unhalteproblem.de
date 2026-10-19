import { mediaUrl, type PostListItem } from "@unhalteproblem.de/api";
import { Clock } from "lucide-react";
import { Link } from "react-router";
import { formatDate, isoDate } from "#lib/format.ts";
import { Badge } from "#ui/Badge.tsx";
import { Card } from "#ui/Card.tsx";

/** A post in a list: cover, title, summary and the facts a reader scans for. */
export function PostCard({
  post,
  showBlog = false,
}: {
  readonly post: PostListItem;
  /** Names the subblog, for feeds across all of them. */
  readonly showBlog?: boolean;
}) {
  return (
    <Card
      interactive
      className="group relative flex h-full flex-col overflow-hidden"
    >
      {post.coverImage !== null && (
        <img
          src={mediaUrl(post.coverImage)}
          alt=""
          loading="lazy"
          className="aspect-[2/1] w-full border-b border-border object-cover"
        />
      )}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
          {showBlog && <span className="text-accent-2">~/{post.blog}</span>}
          <time dateTime={isoDate(post.publishedAt)}>
            {formatDate(post.publishedAt)}
          </time>
          {post.readingMinutes > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock size={12} /> {post.readingMinutes} min
            </span>
          )}
        </p>
        <h3 className="text-xl font-semibold text-fg transition-colors group-hover:text-accent">
          {/* The link covers the whole card. */}
          <Link
            to={`/blog/${post.blog}/${post.slug}`}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {post.title}
          </Link>
        </h3>
        {post.summary !== "" && (
          <p className="line-clamp-3 text-sm text-fg-soft">{post.summary}</p>
        )}
        {post.tags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
            {post.tags.map((tag) => (
              <Badge key={tag}>#{tag}</Badge>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
