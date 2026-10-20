import { Layer } from "effect";
import { OperationsCommands } from "./OperationsCommands.ts";
import { OperationsQueries } from "./OperationsQueries.ts";
import { OperationsRepository } from "./OperationsRepository.ts";

/**
 * The operations domain: the admin panel's view of the database and the
 * outbox. Needs a migrated `SqlClient`, `Transaction`, `AuditCommands` and
 * `UserDirectory`.
 */
export const OperationsLive = Layer.mergeAll(
  OperationsQueries.layer,
  OperationsCommands.layer,
).pipe(Layer.provide(OperationsRepository.layer));
