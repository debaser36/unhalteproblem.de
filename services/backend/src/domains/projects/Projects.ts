import { Layer } from "effect";
import { ProjectCommands } from "./ProjectCommands.ts";
import { ProjectEventLog } from "./ProjectEventLog.ts";
import { ProjectQueries } from "./ProjectQueries.ts";
import { ProjectRepository } from "./ProjectRepository.ts";

/**
 * The projects domain: provides `ProjectCommands` and `ProjectQueries` and
 * runs the event log. Needs a migrated `SqlClient`, `Transaction`,
 * `DomainEvents`, `UserDirectory` and `MediaCommands`.
 */
export const ProjectsLive = ProjectEventLog.pipe(
  Layer.provideMerge(
    Layer.mergeAll(ProjectCommands.layer, ProjectQueries.layer),
  ),
  Layer.provide(ProjectRepository.layer),
);
