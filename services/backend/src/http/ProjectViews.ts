import type {
  ManagedProject,
  ManagedProjectListItem,
  ProjectListItem,
  PublishedProject,
} from "@unhalteproblem.de/api";
import type { ProjectRow } from "#domains/projects/Project";

// Translations from the projects domain to the contract.

export const toProjectListItem = (project: ProjectRow): ProjectListItem => ({
  id: project.id,
  slug: project.slug,
  title: project.title,
  summary: project.summary,
  tags: project.tags,
  status: project.status,
  featured: project.featured,
  repoUrl: project.repoUrl,
  liveUrl: project.liveUrl,
  coverImage: project.coverMediaId,
  updatedAt: project.updatedAt,
});

export const toPublishedProject = (project: ProjectRow): PublishedProject => ({
  ...toProjectListItem(project),
  content: project.content,
});

export const toManagedProjectListItem = (
  project: ProjectRow,
): ManagedProjectListItem => ({
  ...toProjectListItem(project),
  published: project.published,
  position: project.position,
  createdAt: project.createdAt,
  version: project.version,
});

export const toManagedProject = (project: ProjectRow): ManagedProject => ({
  ...toManagedProjectListItem(project),
  content: project.content,
});
