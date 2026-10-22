import { Context, Effect, Layer, type Option, Schema } from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { dieOnSchemaError } from "#infrastructure/Sql";
import { type MediaId, StoredMedia } from "./Media.ts";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insert = SqlSchema.void({
    Request: StoredMedia.insert,
    execute: (row) => sql`INSERT INTO media ${sql.insert(row)}`,
  });

  const find = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: StoredMedia,
    execute: (id) => sql`SELECT * FROM media WHERE id = ${id}`,
  });

  return MediaRepository.of({
    insert: (media) =>
      insert(StoredMedia.insert.make(media)).pipe(
        dieOnSchemaError,
        Effect.withSpan("MediaRepository.insert"),
      ),
    findById: (id) =>
      find(id).pipe(
        dieOnSchemaError,
        Effect.withSpan("MediaRepository.findById"),
      ),
  });
});

/** Storage of uploaded images in `media`. Used only inside the media domain. */
export class MediaRepository extends Context.Service<
  MediaRepository,
  {
    readonly insert: (
      media: StoredMedia,
    ) => Effect.Effect<void, SqlError.SqlError>;
    readonly findById: (
      id: MediaId,
    ) => Effect.Effect<Option.Option<StoredMedia>, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/media/MediaRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(MediaRepository, make);
}
