import { Context, Effect, Layer, Option } from "effect";
import type { SqlError } from "effect/sql";
import type { BlogSlug } from "./Blog.ts";
import { BlogRepository } from "./BlogRepository.ts";

/**
 * What other domains may ask of the blogs domain: whether a subblog exists.
 * Moderation asks before it grants `blogEditor:<slug>`, so no editor role
 * waits for a subblog that might be created later.
 */
export class BlogDirectory extends Context.Service<
  BlogDirectory,
  {
    readonly exists: (
      blog: BlogSlug,
    ) => Effect.Effect<boolean, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/blogs/BlogDirectory") {
  /** Needs `BlogRepository`. */
  static readonly layer = Layer.effect(
    BlogDirectory,
    Effect.gen(function* () {
      const repository = yield* BlogRepository;
      return BlogDirectory.of({
        exists: (blog) => Effect.map(repository.findBlog(blog), Option.isSome),
      });
    }),
  );
}
