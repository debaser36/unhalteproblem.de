import { Layer } from "effect";
import { UserCommands } from "./UserCommands.ts";
import { UserEventLog } from "./UserEventLog.ts";
import { UserQueries } from "./UserQueries.ts";
import { UserRepository } from "./UserRepository.ts";

/**
 * The users domain: provides `UserCommands` and `UserQueries` and runs its
 * event subscribers. The repository stays internal to the domain.
 *
 * Needs a migrated `SqlClient`, `Transaction` and `DomainEvents`.
 */
export const UsersLive = Layer.mergeAll(
  UserCommands.layer,
  UserQueries.layer,
  UserEventLog,
).pipe(Layer.provide(UserRepository.layer));
