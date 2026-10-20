import { mediaUrl, type ProjectListItem } from "@unhalteproblem.de/api";
import { Star } from "lucide-react";
import { Link } from "react-router";
import { cn } from "#lib/cn.ts";
import { Badge } from "#ui/Badge.tsx";
import { Card } from "#ui/Card.tsx";
import { ProjectLinks } from "./ProjectLinks.tsx";
import { ProjectStatusBadge } from "./ProjectStatusBadge.tsx";

/** A project in the list: the whole card opens its page, the buttons its links. */
export function ProjectCard({
  project,
  large = false,
}: {
  readonly project: ProjectListItem;
  /** Featured projects get more room. */
  readonly large?: boolean;
}) {
  return (
    <Card
      interactive
      className="group relative flex h-full flex-col overflow-hidden"
    >
      {project.coverImage !== null && (
        <img
          src={mediaUrl(project.coverImage)}
          alt=""
          loading="lazy"
          className={cn(
            "w-full border-b border-border object-cover",
            large ? "aspect-[16/9]" : "aspect-[2/1]",
          )}
        />
      )}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <ProjectStatusBadge status={project.status} />
          {project.featured && (
            <Badge tone="warning">
              <Star size={11} /> featured
            </Badge>
          )}
        </div>
        <h3
          className={cn(
            "font-semibold text-fg transition-colors group-hover:text-accent",
            large ? "text-2xl" : "text-xl",
          )}
        >
          <Link
            to={`/projects/${project.slug}`}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {project.title}
          </Link>
        </h3>
        {project.summary !== "" && (
          <p className="line-clamp-3 text-sm text-fg-soft">{project.summary}</p>
        )}
        {project.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {project.tags.map((tag) => (
              <Badge key={tag}>#{tag}</Badge>
            ))}
          </div>
        )}
        <div className="mt-auto pt-2">
          <ProjectLinks repoUrl={project.repoUrl} liveUrl={project.liveUrl} />
        </div>
      </div>
    </Card>
  );
}
