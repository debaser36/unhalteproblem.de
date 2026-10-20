import { Layer } from "effect";
import { AuditCleanup } from "./AuditCleanup.ts";
import { AuditCommands } from "./AuditCommands.ts";
import { AuditQueries } from "./AuditQueries.ts";
import { AuditRepository } from "./AuditRepository.ts";

/**
 * The audit domain: provides `AuditCommands` and `AuditQueries` and runs the retention job. The
 * repository stays internal.
 *
 * Needs a migrated `SqlClient` and `Transaction`.
 */
export const AuditLive = Layer.mergeAll(AuditCleanup).pipe(
  Layer.provideMerge(Layer.mergeAll(AuditCommands.layer, AuditQueries.layer)),
  Layer.provide(AuditRepository.layer),
);
