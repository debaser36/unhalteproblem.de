import { Layer } from "effect";
import { BlogCommands } from "./BlogCommands.ts";
import { BlogDirectory } from "./BlogDirectory.ts";
import { BlogEventLog } from "./BlogEventLog.ts";
import { BlogQueries } from "./BlogQueries.ts";
import { BlogRepository } from "./BlogRepository.ts";
import { BlogRequestCommands } from "./BlogRequestCommands.ts";
import { BlogRequestQueries } from "./BlogRequestQueries.ts";
import { BlogRequestRepository } from "./BlogRequestRepository.ts";
import { CategoryCommands } from "./CategoryCommands.ts";
import { CategoryQueries } from "./CategoryQueries.ts";
import { CategoryRepository } from "./CategoryRepository.ts";

/**
 * Whether a subblog exists, for moderation (granting editor roles). Built
 * on its own repository, so moderation doesn't depend on the rest of the
 * blogs domain.
 */
export const BlogDirectoryLive = BlogDirectory.layer.pipe(
  Layer.provide(BlogRepository.layer),
);

/**
 * The blogs domain: provides `BlogCommands`, `BlogQueries`,
 * `BlogRequestCommands`, `BlogRequestQueries`, `CategoryCommands` and
 * `CategoryQueries` and runs the event log.
 * Needs a migrated `SqlClient`, `Transaction`, `DomainEvents`,
 * `UserDirectory`, `MediaCommands`, `AuditCommands` and
 * `ModerationCommands` (approving a request grants the editor role).
 */
export const BlogsLive = BlogEventLog.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      BlogCommands.layer,
      BlogQueries.layer,
      BlogRequestCommands.layer,
      BlogRequestQueries.layer,
      CategoryCommands.layer,
      CategoryQueries.layer,
    ),
  ),
  Layer.provide([
    BlogRepository.layer,
    BlogRequestRepository.layer,
    CategoryRepository.layer,
  ]),
);
