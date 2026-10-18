import { Role } from "@unhalteproblem.de/api";
import type { Subject } from "@unhalteproblem.de/oidc";
import {
  Array as Arr,
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

  const findBySubject = SqlSchema.findOneOption({
    Request: Schema.Struct({ subject: Schema.String, lock: Schema.Boolean }),
    Result: User,
    execute: ({ subject, lock }) => sql`
      SELECT * FROM users WHERE subject = ${subject}
      ${lock ? sql`FOR UPDATE` : sql``}
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

  const rolesOf = SqlSchema.findAll({
    Request: Schema.Struct({ subject: Schema.String }),
    Result: Schema.Struct({ role: Role }),
    execute: ({ subject }) => sql`
      SELECT r.role FROM users u
      JOIN user_roles r ON r.user_id = u.id
      WHERE u.subject = ${subject}
      ORDER BY r.role
    `,
  });

  const grantRoles = SqlSchema.void({
    Request: Schema.Struct({
      userId: Schema.String,
      roles: Schema.NonEmptyArray(Role),
      grantedAt: Schema.DateTimeUtcFromDate,
    }),
    execute: ({ userId, roles, grantedAt }) => sql`
      INSERT INTO user_roles
      ${sql.insert(roles.map((role) => ({ userId, role, grantedAt })))}
      ON CONFLICT (user_id, role) DO NOTHING
    `,
  });

  return UserRepository.of({
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

    rolesOf: (subject) =>
      rolesOf({ subject }).pipe(
        Effect.map(Arr.map(({ role }) => role)),
        dieOnSchemaError,
        Effect.withSpan("UserRepository.rolesOf"),
      ),

    grantRoles: (userId, roles, grantedAt) =>
      Arr.isReadonlyArrayNonEmpty(roles)
        ? grantRoles({ userId, roles, grantedAt }).pipe(
            dieOnSchemaError,
            Effect.withSpan("UserRepository.grantRoles"),
          )
        : Effect.void,
  });
});

/**
 * Storage of `User`s in the `users` table. Used only by the commands and
 * queries of the users domain; everything else goes through those.
 */
export class UserRepository extends Context.Service<
  UserRepository,
  {
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
    /**
     * The roles of the user with this subject, sorted; empty for an unknown
     * subject.
     */
    readonly rolesOf: (
      subject: typeof Subject.Type,
    ) => Effect.Effect<ReadonlyArray<Role>, SqlError.SqlError>;
    /** Grants the roles; ones the user already has are left as they are. */
    readonly grantRoles: (
      userId: UserId,
      roles: ReadonlyArray<Role>,
      grantedAt: DateTime.Utc,
    ) => Effect.Effect<void, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/users/UserRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(UserRepository, make);
}
