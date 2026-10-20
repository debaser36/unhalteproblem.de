import {
  mediaUrl,
  type MediaId,
  type ProjectStatus,
} from "@unhalteproblem.de/api";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Badge } from "#ui/Badge.tsx";
import { ProjectLinks } from "./ProjectLinks.tsx";
import { ProjectStatusBadge } from "./ProjectStatusBadge.tsx";

/** The top of a project page; shared by the reader's view and the editor. */
export function ProjectHeader({
  title,
  summary,
  status,
  tags,
  repoUrl,
  liveUrl,
  coverImage,
  aside,
}: {
  readonly title: ReactNode;
  readonly summary: ReactNode;
  readonly status: ProjectStatus;
  readonly tags: ReadonlyArray<string>;
  readonly repoUrl: string | null;
  readonly liveUrl: string | null;
  readonly coverImage: MediaId | null;
  readonly aside?: ReactNode;
}) {
  return (
    <header className="space-y-6 pt-10 pb-8 sm:pt-14">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-3 font-mono text-sm text-muted">
          <Link to="/projects" className="text-accent-2 hover:underline">
            ~/projects
          </Link>
          <ProjectStatusBadge status={status} />
        </p>
        {aside}
      </div>
      {title}
      {summary}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag}>#{tag}</Badge>
          ))}
        </div>
      )}
      <ProjectLinks repoUrl={repoUrl} liveUrl={liveUrl} size="md" />
      {coverImage !== null && (
        <img
          src={mediaUrl(coverImage)}
          alt=""
          className="mt-4 aspect-[16/9] w-full rounded-xl border border-border object-cover"
        />
      )}
    </header>
  );
}
