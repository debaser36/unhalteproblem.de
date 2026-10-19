import { Layer } from "effect";
import { BlogCommands } from "./BlogCommands.ts";
import { BlogDirectory } from "./BlogDirectory.ts";
import { BlogEventLog } from "./BlogEventLog.ts";
import { BlogQueries } from "./BlogQueries.ts";
import { BlogRepository } from "./BlogRepository.ts";

/**
 * Whether a subblog exists, for moderation (granting editor roles). Built
 * on its own repository, so moderation doesn't depend on the rest of the
 * blogs domain.
 */
export const BlogDirectoryLive = BlogDirectory.layer.pipe(
  Layer.provide(BlogRepository.layer),
);

/**
 * The blogs domain: provides `BlogCommands` and `BlogQueries` and runs the
 * event log. Needs a migrated `SqlClient`, `Transaction`, `DomainEvents`,
 * `UserDirectory` and `MediaCommands`.
 */
export const BlogsLive = BlogEventLog.pipe(
  Layer.provideMerge(Layer.mergeAll(BlogCommands.layer, BlogQueries.layer)),
  Layer.provide(BlogRepository.layer),
);
