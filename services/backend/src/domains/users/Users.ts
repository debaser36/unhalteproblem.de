import { Layer } from "effect";
import { ModerationRepository } from "./ModerationRepository.ts";
import { UserCommands } from "./UserCommands.ts";
import { UserEventLog } from "./UserEventLog.ts";
import { UserQueries } from "./UserQueries.ts";
import { UserRepository } from "./UserRepository.ts";

/**
 * The users domain: provides `UserCommands` and `UserQueries` and runs its
 * event subscribers. The repositories stay internal to the domain.
 *
 * Needs a migrated `SqlClient`, `Transaction`, `DomainEvents` and
 * `Sessions` (restricting a user ends their sessions).
 */
export const UsersLive = Layer.mergeAll(
  UserCommands.layer,
  UserQueries.layer,
  UserEventLog,
).pipe(Layer.provide([UserRepository.layer, ModerationRepository.layer]));
