import { ExternalLink } from "lucide-react";
import { ExternalButtonLink } from "#ui/Button.tsx";
import { GithubIcon } from "#ui/GithubIcon.tsx";

/** "Source" and "Open" buttons for a project's links, where it has them. */
export function ProjectLinks({
  repoUrl,
  liveUrl,
  size = "sm",
}: {
  readonly repoUrl: string | null;
  readonly liveUrl: string | null;
  readonly size?: "sm" | "md";
}) {
  if (repoUrl === null && liveUrl === null) return null;
  return (
    <div className="relative z-10 flex flex-wrap gap-2">
      {repoUrl !== null && (
        <ExternalButtonLink
          href={repoUrl}
          size={size}
          icon={<GithubIcon size={14} />}
        >
          Source
        </ExternalButtonLink>
      )}
      {liveUrl !== null && (
        <ExternalButtonLink
          href={liveUrl}
          size={size}
          variant="primary"
          icon={<ExternalLink size={14} />}
        >
          Open
        </ExternalButtonLink>
      )}
    </div>
  );
}
