import { Layer } from "effect";
import { KeycloakUserDeletion } from "./AccountDeletion.ts";
import { UserCommands } from "./UserCommands.ts";
import { UserDirectory } from "./UserDirectory.ts";
import { UserEventLog } from "./UserEventLog.ts";
import { UserQueries } from "./UserQueries.ts";
import { UserRepository } from "./UserRepository.ts";

/**
 * The users domain, in two parts because moderation sits between them:
 *
 * - `UserDirectoryLive` provides `UserDirectory` (find and lock users),
 *   which moderation needs and which depends on nothing else.
 * - `UsersLive` provides `UserCommands` and `UserQueries` and runs the
 *   event log; it needs `ModerationCommands` and `ModerationQueries`.
 *
 * Both need a migrated `SqlClient`; `UsersLive` also `Transaction`,
 * `DomainEvents`, `Outbox`, `AuditCommands`, `Sessions` and `KeycloakAdmin`. The repository stays internal to each.
 */
export const UserDirectoryLive = UserDirectory.layer.pipe(
  Layer.provide(UserRepository.layer),
);

export const UsersLive = Layer.mergeAll(
  UserCommands.layer,
  UserQueries.layer,
  UserEventLog,
  KeycloakUserDeletion,
).pipe(Layer.provide(UserRepository.layer));
