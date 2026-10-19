import { Layer } from "effect";
import { MediaCommands } from "./MediaCommands.ts";
import { MediaQueries } from "./MediaQueries.ts";
import { MediaRepository } from "./MediaRepository.ts";

/**
 * The media domain: provides `MediaCommands` and `MediaQueries`; the
 * repository stays internal. Needs a migrated `SqlClient` and `Transaction`.
 */
export const MediaLive = Layer.mergeAll(
  MediaCommands.layer,
  MediaQueries.layer,
).pipe(Layer.provide(MediaRepository.layer));
