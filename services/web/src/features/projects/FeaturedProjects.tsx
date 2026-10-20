import { AsyncView } from "#api/AsyncView.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { Skeleton } from "#ui/Skeleton.tsx";
import { ProjectCard } from "./ProjectCard.tsx";
import { projectsAtom } from "./projectAtoms.ts";

/** The first projects of the list (featured ones lead it), for the home page. */
export function FeaturedProjects({ count = 3 }: { readonly count?: number }) {
  return (
    <AsyncView
      atom={projectsAtom}
      loading={
        <div className="grid gap-5 md:grid-cols-3">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      }
    >
      {(projects) =>
        projects.length === 0 ? (
          <EmptyState title="No projects published yet." />
        ) : (
          <div className="grid gap-5 md:grid-cols-3">
            {projects.slice(0, count).map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )
      }
    </AsyncView>
  );
}
