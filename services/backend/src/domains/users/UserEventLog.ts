import { Effect, Schema } from "effect";
import * as DomainEvent from "#cqrs/DomainEvent";
import { UserProfileChanged, UserRegistered } from "./User.ts";

/**
 * Logs the users domain's events. Only ids and field names: the profile
 * values themselves are personal data and stay out of the log.
 */
export const UserEventLog = DomainEvent.subscriber(
  "UserEventLog",
  Schema.Union([UserRegistered, UserProfileChanged]),
  (event) =>
    Effect.logInfo(
      event._tag === "UserRegistered"
        ? "User registered"
        : "User profile changed",
    ).pipe(
      Effect.annotateLogs({
        userId: event.userId,
        ...(event._tag === "UserProfileChanged"
          ? { fields: event.fields.join(",") }
          : {}),
      }),
    ),
);
