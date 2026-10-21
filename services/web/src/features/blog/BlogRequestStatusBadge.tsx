import type { BlogRequestStatus } from "@unhalteproblem.de/api";
import { Badge, type BadgeTone } from "#ui/Badge.tsx";

const tones: Record<BlogRequestStatus, BadgeTone> = {
  pending: "warning",
  approved: "accent",
  rejected: "danger",
  withdrawn: "neutral",
};

/** A blog request's status, as a badge. */
export function BlogRequestStatusBadge({
  status,
}: {
  readonly status: BlogRequestStatus;
}) {
  return <Badge tone={tones[status]}>{status}</Badge>;
}
