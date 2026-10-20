import type { ProjectStatus } from "@unhalteproblem.de/api";
import { Badge, type BadgeTone } from "#ui/Badge.tsx";

const tones: Record<ProjectStatus, BadgeTone> = {
  active: "accent",
  completed: "info",
  archived: "neutral",
};

export function ProjectStatusBadge({
  status,
}: {
  readonly status: ProjectStatus;
}) {
  return (
    <Badge tone={tones[status]}>
      {status === "active" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
      )}
      {status}
    </Badge>
  );
}
