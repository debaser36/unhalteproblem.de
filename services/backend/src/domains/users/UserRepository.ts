import type { Subject } from "@unhalteproblem.de/oidc";
import {
  Cause,
  Context,
  type DateTime,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import { SqlClient, type SqlError, SqlModel, SqlSchema } from "effect/sql";
import { dieOnSchemaError } from "#repositories/Sql";
import { User, type UserId } from "./User.ts";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const repository = yield* SqlModel.makeRepository(User, {
    tableName: "users",
    spanPrefix: "UserRepository",
    idColumn: "id",
  });

  // FOR NO KEY UPDATE, not FOR UPDATE: nothing changes users.id, and the
  // weaker lock doesn't conflict with the KEY SHARE that foreign keys to
  // users (e.g. restricted_by) take, which would deadlock moderators acting
  // on each other.
  const lockForUpdate = SqlSchema.findAll({
    Request: Schema.Struct({ ids: Schema.Array(Schema.String) }),
    Result: User,
    execute: ({ ids }) => sql`
      SELECT * FROM users WHERE ${sql.in("id", ids)}
      ORDER BY id
      FOR NO KEY UPDATE
    `,
  });

  // Keyset paging: the position is the (created_at, id) of the last user
  // seen, so a page costs the same however deep it is, and users who
  // register meanwhile never shift the pages already read. `users_created_at_id_idx`
  // serves both the comparison and the order.
  const page = SqlSchema.findAll({
    Request: Schema.Struct({
      limit: Schema.Int,
      after: Schema.NullOr(
        Schema.Struct({
          createdAt: Schema.DateTimeUtcFromDate,
          id: Schema.String,
        }),
      ),
    }),
    Result: User,
    execute: ({ limit, after }) => sql`
      SELECT * FROM users
      ${
        after === null
          ? sql``
          : sql`WHERE (created_at, id) > (${after.createdAt}, ${after.id}::uuid)`
      }
      ORDER BY created_at, id
      LIMIT ${limit}
    `,
  });

  const findBySubject = SqlSchema.findOneOption({
    Request: Schema.Struct({ subject: Schema.String, lock: Schema.Boolean }),
    Result: User,
    execute: ({ subject, lock }) => sql`
      SELECT * FROM users WHERE subject = ${subject}
      ${lock ? sql`FOR NO KEY UPDATE` : sql``}
    `,
  });

  const insertIfAbsent = SqlSchema.findOneOption({
    Request: User.insert,
    Result: Schema.Struct({ id: Schema.String }),
    execute: (row) => sql`
      INSERT INTO users ${sql.insert(row)}
      ON CONFLICT (subject) DO NOTHING
      RETURNING id
    `,
  });

  return UserRepository.of({
    lockForUpdate: (ids) =>
      lockForUpdate({ ids: [...new Set(ids)] }).pipe(
        dieOnSchemaError,
        Effect.withSpan("UserRepository.lockForUpdate"),
      ),

    page: ({ limit, after }) =>
      page({ limit, after: Option.getOrNull(after) }).pipe(
        dieOnSchemaError,
        Effect.withSpan("UserRepository.page"),
      ),

    findById: (id) =>
      repository.findById(id).pipe(
        Effect.asSome,
        Effect.catchIf(Cause.isNoSuchElementError, () => Effect.succeedNone),
        dieOnSchemaError,
      ),

    findBySubject: (subject) =>
      findBySubject({ subject, lock: false }).pipe(
        dieOnSchemaError,
        Effect.withSpan("UserRepository.findBySubject"),
      ),

    findBySubjectForUpdate: (subject) =>
      findBySubject({ subject, lock: true }).pipe(
        dieOnSchemaError,
        Effect.withSpan("UserRepository.findBySubjectForUpdate"),
      ),

    insertIfAbsent: (user) =>
      insertIfAbsent(User.insert.make(user)).pipe(
        Effect.map(Option.isSome),
        dieOnSchemaError,
        Effect.withSpan("UserRepository.insertIfAbsent"),
      ),

    update: (user) =>
      repository.updateVoid(User.update.make(user)).pipe(dieOnSchemaError),
  });
});

/**
 * Storage of `User`s in the `users` table. Used only by the commands and
 * queries of the users domain; everything else goes through those.
 */
export class UserRepository extends Context.Service<
  UserRepository,
  {
    /**
     * The users with these ids (duplicates allowed), locked until the
     * transaction ends. Locks in id order, so commands locking the same
     * users can't deadlock each other.
     */
    readonly lockForUpdate: (
      ids: ReadonlyArray<UserId>,
    ) => Effect.Effect<ReadonlyArray<User>, SqlError.SqlError>;
    /**
     * Up to `limit` users, oldest registration first (then by id), starting
     * after the user at position `after`.
     */
    readonly page: (page: {
      readonly limit: number;
      readonly after: Option.Option<{
        readonly createdAt: DateTime.Utc;
        readonly id: UserId;
      }>;
    }) => Effect.Effect<ReadonlyArray<User>, SqlError.SqlError>;
    readonly findById: (
      id: UserId,
    ) => Effect.Effect<Option.Option<User>, SqlError.SqlError>;
    readonly findBySubject: (
      subject: typeof Subject.Type,
    ) => Effect.Effect<Option.Option<User>, SqlError.SqlError>;
    /**
     * Like `findBySubject`, but locks the row until the transaction ends,
     * so concurrent logins of the same user update it one after the other.
     */
    readonly findBySubjectForUpdate: (
      subject: typeof Subject.Type,
    ) => Effect.Effect<Option.Option<User>, SqlError.SqlError>;
    /**
     * Inserts the user unless one with the same subject exists, and returns
     * whether it did. Waits for a concurrent insert of that subject, so
     * `false` means the other user is committed and can be read by the next
     * statement. That relies on READ COMMITTED, the default; under
     * REPEATABLE READ the conflict is a serialization failure instead.
     */
    readonly insertIfAbsent: (
      user: User,
    ) => Effect.Effect<boolean, SqlError.SqlError>;
    /** Stores the user's changeable fields (all but subject and createdAt). */
    readonly update: (user: User) => Effect.Effect<void, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/users/UserRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(UserRepository, make);
}
