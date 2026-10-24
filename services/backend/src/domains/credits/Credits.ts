import { Layer } from "effect";
import { CreditCommands } from "./CreditCommands.ts";
import { CreditQueries } from "./CreditQueries.ts";
import { CreditRepository } from "./CreditRepository.ts";

/**
 * The credits domain: provides `CreditCommands` and `CreditQueries`. The
 * repository stays internal.
 *
 * Needs a migrated `SqlClient`, `Transaction` and `UserDirectory`.
 */
export const CreditsLive = Layer.mergeAll(
  CreditCommands.layer,
  CreditQueries.layer,
).pipe(Layer.provide(CreditRepository.layer));
