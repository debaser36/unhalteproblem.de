import { Effect, Match, Schema } from "effect";
import * as DomainEvent from "#cqrs/DomainEvent";
import { UserProfileChanged, UserRegistered } from "./User.ts";

/**
 * Logs the users domain's events. Only ids and field names: profile values
 * are personal data and stay out of the log.
 */
export const UserEventLog = DomainEvent.subscriber(
  "UserEventLog",
  Schema.Union([UserRegistered, UserProfileChanged]),
  (event) =>
    Match.valueTags(event, {
      UserRegistered: ({ userId }) =>
        Effect.logInfo("User registered").pipe(Effect.annotateLogs({ userId })),
      UserProfileChanged: ({ userId, fields }) =>
        Effect.logInfo("User profile changed").pipe(
          Effect.annotateLogs({ userId, fields: fields.join(",") }),
        ),
    }),
);
