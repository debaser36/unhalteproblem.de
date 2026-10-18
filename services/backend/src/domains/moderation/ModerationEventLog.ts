import { Effect, Match, Schema } from "effect";
import * as DomainEvent from "#cqrs/DomainEvent";
import {
  RestrictionLifted,
  RoleGranted,
  RoleRevoked,
  UserRestricted,
} from "./Moderation.ts";

/**
 * Logs the moderation domain's events. Only ids and roles: restriction
 * notes are personal data and stay out of the log.
 */
export const ModerationEventLog = DomainEvent.subscriber(
  "ModerationEventLog",
  Schema.Union([RoleGranted, RoleRevoked, UserRestricted, RestrictionLifted]),
  (event) =>
    Match.valueTags(event, {
      RoleGranted: ({ userId, role, by }) =>
        Effect.logInfo("Role granted").pipe(
          Effect.annotateLogs({ userId, role, by }),
        ),
      RoleRevoked: ({ userId, role, by }) =>
        Effect.logInfo("Role revoked").pipe(
          Effect.annotateLogs({ userId, role, by }),
        ),
      UserRestricted: ({ userId, restrictionId, by }) =>
        Effect.logInfo("User restricted").pipe(
          Effect.annotateLogs({ userId, restrictionId, by }),
        ),
      RestrictionLifted: ({ userId, restrictionId, by }) =>
        Effect.logInfo("Restriction lifted").pipe(
          Effect.annotateLogs({ userId, restrictionId, by }),
        ),
    }),
);
