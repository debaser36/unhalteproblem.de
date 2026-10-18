import { Layer } from "effect";
import { ModerationCommands } from "./ModerationCommands.ts";
import { ModerationEventLog } from "./ModerationEventLog.ts";
import { ModerationQueries } from "./ModerationQueries.ts";
import { ModerationRepository } from "./ModerationRepository.ts";

/**
 * The moderation domain: provides `ModerationCommands` and
 * `ModerationQueries` and runs its event log. The repository stays internal.
 *
 * Needs a migrated `SqlClient`, `Transaction`, `DomainEvents`, `UserDirectory`
 * and `Sessions` (restricting a user ends their sessions).
 */
export const ModerationLive = Layer.mergeAll(
  ModerationCommands.layer,
  ModerationQueries.layer,
  ModerationEventLog,
).pipe(Layer.provide(ModerationRepository.layer));
