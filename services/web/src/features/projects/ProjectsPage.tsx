import { useAtomValue } from "@effect/atom-react";
import type { ProjectListItem, ProjectStatus } from "@unhalteproblem.de/api";
import { Plus } from "lucide-react";
import { useState } from "react";
import { AsyncView } from "#api/AsyncView.tsx";
import { hasRole, userAtom } from "#api/session.ts";
import { Seo } from "#app/Seo.tsx";
import { cn } from "#lib/cn.ts";
import { ButtonLink } from "#ui/Button.tsx";
import { Container } from "#ui/Container.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { PageHeader } from "#ui/PageHeader.tsx";
import { ProjectCard } from "./ProjectCard.tsx";
import { newProjectPath, projectsAtom } from "./projectAtoms.ts";

const filters: ReadonlyArray<ProjectStatus | "all"> = [
  "all",
  "active",
  "completed",
  "archived",
];

export function ProjectsPage() {
  const user = useAtomValue(userAtom);
  const [filter, setFilter] = useState<ProjectStatus | "all">("all");
  return (
    <Container width="wide">
      <Seo
        title="Projects"
        description="Software projects by Nico: what they do, how they are built and where to find the source."
        path="/projects"
      />
      <PageHeader
        path="~/projects"
        title="Projects"
        actions={
          hasRole(user, "admin") && (
            <ButtonLink
              to={newProjectPath}
              variant="primary"
              icon={<Plus size={15} />}
            >
              New project
            </ButtonLink>
          )
        }
      >
        Things I built or am building, with the story behind them, the source
        and, where there is one, a running version.
      </PageHeader>
      <div
        role="tablist"
        aria-label="Filter by status"
        className="mb-6 flex flex-wrap gap-1.5"
      >
        {filters.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "rounded-md px-3 py-1.5 font-mono text-sm transition-colors",
              filter === value
                ? "bg-accent-soft text-accent"
                : "text-fg-soft hover:bg-surface-2 hover:text-fg",
            )}
          >
            {value}
          </button>
        ))}
      </div>
      <AsyncView atom={projectsAtom}>
        {(projects) => (
          <Grid
            projects={
              filter === "all"
                ? projects
                : projects.filter((p) => p.status === filter)
            }
          />
        )}
      </AsyncView>
    </Container>
  );
}

function Grid({
  projects,
}: {
  readonly projects: ReadonlyArray<ProjectListItem>;
}) {
  if (projects.length === 0) return <EmptyState title="Nothing here yet." />;
  const featured = projects.filter((p) => p.featured);
  const rest = projects.filter((p) => !p.featured);
  return (
    <div className="space-y-5">
      {featured.length > 0 && (
        <div className="grid gap-5 md:grid-cols-2">
          {featured.map((project) => (
            <ProjectCard key={project.id} project={project} large />
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
