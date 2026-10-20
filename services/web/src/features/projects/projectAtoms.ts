import type { ProjectId } from "@unhalteproblem.de/api";
import { ApiClient } from "#api/ApiClient.ts";

/** Reactivity key of everything shown about projects. */
export const projectsKey = "projects";

export const projectsAtom = ApiClient.query("projects", "listProjects", {
  reactivityKeys: [projectsKey],
  timeToLive: "5 minutes",
});

export const projectAtom = (project: string) =>
  ApiClient.query("projects", "getProject", {
    params: { project },
    reactivityKeys: [projectsKey],
  });

export const managedProjectsAtom = ApiClient.query(
  "projectAdmin",
  "listManagedProjects",
  {
    reactivityKeys: [projectsKey],
  },
);

export const managedProjectAtom = (projectId: ProjectId) =>
  ApiClient.query("projectAdmin", "getManagedProject", {
    params: { projectId },
    reactivityKeys: [projectsKey],
  });

export const createProject = ApiClient.mutation(
  "projectAdmin",
  "createProject",
);
export const updateProject = ApiClient.mutation(
  "projectAdmin",
  "updateProject",
);
export const deleteProject = ApiClient.mutation(
  "projectAdmin",
  "deleteProject",
);
export const uploadProjectMedia = ApiClient.mutation(
  "projectAdmin",
  "uploadProjectMedia",
);

/** Where to write a new project, and edit any project by id. */
export const newProjectPath = "/projects/~new";
export const editProjectPath = (id: ProjectId) => `/projects/~edit/${id}`;
