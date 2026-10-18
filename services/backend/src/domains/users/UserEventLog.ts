import { Effect, Match, Schema } from "effect";
import * as DomainEvent from "#cqrs/DomainEvent";
import {
  RestrictionLifted,
  RoleGranted,
  RoleRevoked,
  UserRestricted,
} from "./Moderation.ts";
import { UserProfileChanged, UserRegistered } from "./User.ts";

/**
 * Logs the users domain's events. Only ids, roles and field names: profile
 * values and restriction notes are personal data and stay out of the log.
 */
export const UserEventLog = DomainEvent.subscriber(
  "UserEventLog",
  Schema.Union([
    UserRegistered,
    UserProfileChanged,
    RoleGranted,
    RoleRevoked,
    UserRestricted,
    RestrictionLifted,
  ]),
  (event) =>
    Match.valueTags(event, {
      UserRegistered: ({ userId }) =>
        Effect.logInfo("User registered").pipe(Effect.annotateLogs({ userId })),
      UserProfileChanged: ({ userId, fields }) =>
        Effect.logInfo("User profile changed").pipe(
          Effect.annotateLogs({ userId, fields: fields.join(",") }),
        ),
      RoleGranted: ({ userId, role, by }) =>
        Effect.logInfo("Role granted").pipe(
          Effect.annotateLogs({
            userId,
            role,
            by,
          }),
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
