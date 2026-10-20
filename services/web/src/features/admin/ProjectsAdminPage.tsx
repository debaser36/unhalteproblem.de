import { ExternalLink, PenLine, Plus, Star } from "lucide-react";
import { AsyncView } from "#api/AsyncView.tsx";
import {
  editProjectPath,
  managedProjectsAtom,
  newProjectPath,
} from "#features/projects/projectAtoms.ts";
import { ProjectStatusBadge } from "#features/projects/ProjectStatusBadge.tsx";
import { formatDateTime } from "#lib/format.ts";
import { Badge } from "#ui/Badge.tsx";
import { ButtonLink } from "#ui/Button.tsx";
import { EmptyState } from "#ui/EmptyState.tsx";
import { Table, Td, Th } from "#ui/Table.tsx";
import { AdminHeading } from "./AdminHeading.tsx";

export function ProjectsAdminPage() {
  return (
    <>
      <AdminHeading
        title="Projects"
        actions={
          <ButtonLink
            to={newProjectPath}
            variant="primary"
            size="sm"
            icon={<Plus size={14} />}
          >
            New project
          </ButtonLink>
        }
      >
        All projects, hidden ones included, in the order of the projects page.
      </AdminHeading>
      <AsyncView atom={managedProjectsAtom}>
        {(projects) =>
          projects.length === 0 ? (
            <EmptyState title="No projects yet." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Project</Th>
                  <Th>Status</Th>
                  <Th>Visible</Th>
                  <Th>Last change</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="hover:bg-surface-2/50">
                    <Td>
                      <p className="flex items-center gap-1.5 font-medium text-fg">
                        {project.featured && (
                          <Star size={13} className="text-warning" />
                        )}
                        {project.title}
                      </p>
                      <p className="font-mono text-xs text-muted">
                        /{project.slug} · position {project.position}
                      </p>
                    </Td>
                    <Td>
                      <ProjectStatusBadge status={project.status} />
                    </Td>
                    <Td>
                      <Badge tone={project.published ? "accent" : "warning"}>
                        {project.published ? "published" : "hidden"}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {formatDateTime(project.updatedAt)}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <ButtonLink
                        size="sm"
                        variant="ghost"
                        to={editProjectPath(project.id)}
                        icon={<PenLine size={14} />}
                      >
                        Edit
                      </ButtonLink>
                      {project.published && (
                        <ButtonLink
                          size="sm"
                          variant="ghost"
                          to={`/projects/${project.slug}`}
                          icon={<ExternalLink size={14} />}
                        >
                          View
                        </ButtonLink>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        }
      </AsyncView>
    </>
  );
}
