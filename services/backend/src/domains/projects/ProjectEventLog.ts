import { Effect, Match, Schema } from "effect";
import * as DomainEvent from "#cqrs/DomainEvent";
import { ProjectDeleted, ProjectSaved } from "./Project.ts";

/** Logs the projects domain's events: ids only. */
export const ProjectEventLog = DomainEvent.subscriber(
  "ProjectEventLog",
  Schema.Union([ProjectSaved, ProjectDeleted]),
  (event) =>
    Match.valueTags(event, {
      ProjectSaved: ({ projectId, version, by }) =>
        Effect.logInfo("Project saved").pipe(
          Effect.annotateLogs({ projectId, version, by }),
        ),
      ProjectDeleted: ({ projectId, by }) =>
        Effect.logInfo("Project deleted").pipe(
          Effect.annotateLogs({ projectId, by }),
        ),
    }),
);
