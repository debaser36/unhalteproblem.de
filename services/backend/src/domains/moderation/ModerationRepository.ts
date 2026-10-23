import { Role } from "@unhalteproblem.de/api";
import type { Subject } from "@unhalteproblem.de/oidc";
import {
  Array as Arr,
  Context,
  type DateTime,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { dieOnSchemaError } from "#infrastructure/Sql";
import {
  Restriction,
  type RestrictionId,
  RoleChange,
  RoleChangeKind,
} from "./Moderation.ts";
import { UserId } from "#domains/users/User";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const rolesOfUsers = SqlSchema.findAll({
    Request: Schema.Struct({ ids: Schema.Array(Schema.String) }),
    Result: Schema.Struct({ userId: UserId, role: Role }),
    execute: ({ ids }) => sql`
      SELECT user_id, role FROM user_roles
      WHERE ${sql.in("user_id", ids)}
      ORDER BY role
    `,
  });

  const grantRole = SqlSchema.findOneOption({
    Request: Schema.Struct({
      userId: Schema.String,
      role: Role,
      grantedBy: Schema.NullOr(Schema.String),
      grantedAt: Schema.DateTimeUtcFromDate,
    }),
    Result: Schema.Struct({ role: Role }),
    // A role held only through a payment becomes a manual grant: it then
    // stays when the payment no longer entitles the user to it.
    execute: (row) => sql`
      INSERT INTO user_roles ${sql.insert(row)}
      ON CONFLICT (user_id, role) DO UPDATE SET
        manual = true,
        granted_by = EXCLUDED.granted_by,
        granted_at = EXCLUDED.granted_at
      WHERE NOT user_roles.manual
      RETURNING role
    `,
  });

  const grantPaidRole = SqlSchema.findOneOption({
    Request: Schema.Struct({
      userId: Schema.String,
      role: Role,
      grantedAt: Schema.DateTimeUtcFromDate,
    }),
    Result: Schema.Struct({ role: Role }),
    execute: ({ userId, role, grantedAt }) => sql`
      INSERT INTO user_roles (user_id, role, granted_at, manual)
      VALUES (${userId}, ${role}, ${grantedAt}, false)
      ON CONFLICT (user_id, role) DO NOTHING
      RETURNING role
    `,
  });

  const revokePaidRole = SqlSchema.findOneOption({
    Request: Schema.Struct({ userId: Schema.String, role: Role }),
    Result: Schema.Struct({ role: Role }),
    execute: ({ userId, role }) => sql`
      DELETE FROM user_roles
      WHERE user_id = ${userId} AND role = ${role} AND NOT manual
      RETURNING role
    `,
  });

  const paidRolesOf = SqlSchema.findAll({
    Request: Schema.String,
    Result: Schema.Struct({ role: Role }),
    execute: (userId) => sql`
      SELECT role FROM user_roles WHERE user_id = ${userId} AND NOT manual
      ORDER BY role
    `,
  });

  const revokeRole = SqlSchema.findOneOption({
    Request: Schema.Struct({ userId: Schema.String, role: Role }),
    Result: Schema.Struct({ role: Role }),
    execute: ({ userId, role }) => sql`
      DELETE FROM user_roles WHERE user_id = ${userId} AND role = ${role}
      RETURNING role
    `,
  });

  const recordRoleChange = SqlSchema.void({
    Request: Schema.Struct({
      userId: Schema.String,
      role: Role,
      change: RoleChangeKind,
      changedBy: Schema.NullOr(Schema.String),
      changedAt: Schema.DateTimeUtcFromDate,
    }),
    execute: (row) => sql`INSERT INTO user_role_changes ${sql.insert(row)}`,
  });

  const roleChangesOf = SqlSchema.findAll({
    Request: Schema.Struct({ userId: Schema.String }),
    Result: RoleChange,
    execute: ({ userId }) => sql`
      SELECT role, change, changed_by, changed_at FROM user_role_changes
      WHERE user_id = ${userId}
      ORDER BY changed_at, id
    `,
  });

  const insertActive = SqlSchema.findOneOption({
    Request: Restriction.insert,
    Result: Schema.Struct({ id: Schema.String }),
    execute: (row) => sql`
      INSERT INTO user_restrictions ${sql.insert(row)}
      ON CONFLICT (user_id) WHERE lifted_at IS NULL DO NOTHING
      RETURNING id
    `,
  });

  const lift = SqlSchema.void({
    Request: Schema.Struct({
      id: Schema.String,
      liftedAt: Schema.DateTimeUtcFromDate,
      liftedBy: Schema.String,
      liftNote: Schema.NullOr(Schema.String),
    }),
    execute: ({ id, liftedAt, liftedBy, liftNote }) => sql`
      UPDATE user_restrictions
      SET lifted_at = ${liftedAt}, lifted_by = ${liftedBy}, lift_note = ${liftNote}
      WHERE id = ${id} AND lifted_at IS NULL
    `,
  });

  const findActive = SqlSchema.findOneOption({
    Request: Schema.Struct({ userId: Schema.String }),
    Result: Restriction,
    execute: ({ userId }) => sql`
      SELECT * FROM user_restrictions
      WHERE user_id = ${userId} AND lifted_at IS NULL
      FOR UPDATE
    `,
  });

  const activeOf = SqlSchema.findAll({
    Request: Schema.Struct({ ids: Schema.Array(Schema.String) }),
    Result: Restriction,
    execute: ({ ids }) => sql`
      SELECT * FROM user_restrictions
      WHERE ${sql.in("user_id", ids)} AND lifted_at IS NULL
    `,
  });

  const historyOf = SqlSchema.findAll({
    Request: Schema.Struct({ userId: Schema.String }),
    Result: Restriction,
    execute: ({ userId }) => sql`
      SELECT * FROM user_restrictions
      WHERE user_id = ${userId}
      ORDER BY restricted_at DESC, lifted_at DESC NULLS FIRST, id
    `,
  });

  const accessOf = SqlSchema.findOneOption({
    Request: Schema.Struct({ subject: Schema.String }),
    Result: Schema.Struct({
      roles: Schema.Array(Role),
      restricted: Schema.Boolean,
    }),
    execute: ({ subject }) => sql`
      SELECT
        ARRAY(
          SELECT r.role FROM user_roles r
          WHERE r.user_id = u.id ORDER BY r.role
        ) AS roles,
        (
          u.deleted_at IS NOT NULL OR EXISTS (
            SELECT 1 FROM user_restrictions x
            WHERE x.user_id = u.id AND x.lifted_at IS NULL
          )
        ) AS restricted
      FROM users u
      WHERE u.subject = ${subject}
    `,
  });

  const byUser = <A extends { readonly userId: UserId }>(
    rows: ReadonlyArray<A>,
  ): ReadonlyMap<UserId, ReadonlyArray<A>> => {
    const map = new Map<UserId, Array<A>>();
    for (const row of rows) {
      const list = map.get(row.userId) ?? [];
      list.push(row);
      map.set(row.userId, list);
    }
    return map;
  };

  return ModerationRepository.of({
    rolesOfUsers: (ids) =>
      Arr.isReadonlyArrayNonEmpty(ids)
        ? rolesOfUsers({ ids }).pipe(
            Effect.map(
              (rows) =>
                new Map(
                  Array.from(byUser(rows), ([userId, list]) => [
                    userId,
                    list.map(({ role }) => role),
                  ]),
                ),
            ),
            dieOnSchemaError,
            Effect.withSpan("ModerationRepository.rolesOfUsers"),
          )
        : Effect.succeed(new Map()),

    isHeld: (role) =>
      sql<{ readonly held: boolean }>`
        SELECT EXISTS (SELECT 1 FROM user_roles WHERE role = ${role}) AS held
      `.pipe(
        Effect.map((rows) => rows[0]?.held === true),
        Effect.withSpan("ModerationRepository.isHeld"),
      ),

    lockSuperAdmins: sql<{ readonly userId: UserId }>`
      SELECT user_id FROM user_roles WHERE role = 'superAdmin' FOR UPDATE
    `.pipe(
      Effect.map((rows) => rows.map(({ userId }) => userId)),
      Effect.withSpan("ModerationRepository.lockSuperAdmins"),
    ),

    grantRole: ({ userId, role, by, at }) =>
      grantRole({
        userId,
        role,
        grantedBy: Option.getOrNull(by),
        grantedAt: at,
      }).pipe(
        Effect.map(Option.isSome),
        dieOnSchemaError,
        Effect.withSpan("ModerationRepository.grantRole"),
      ),

    revokeRole: (userId, role) =>
      revokeRole({ userId, role }).pipe(
        Effect.map(Option.isSome),
        dieOnSchemaError,
        Effect.withSpan("ModerationRepository.revokeRole"),
      ),

    grantPaidRole: ({ userId, role, at }) =>
      grantPaidRole({ userId, role, grantedAt: at }).pipe(
        Effect.map(Option.isSome),
        dieOnSchemaError,
        Effect.withSpan("ModerationRepository.grantPaidRole"),
      ),

    revokePaidRole: (userId, role) =>
      revokePaidRole({ userId, role }).pipe(
        Effect.map(Option.isSome),
        dieOnSchemaError,
        Effect.withSpan("ModerationRepository.revokePaidRole"),
      ),

    paidRoleHolders: sql<{ readonly userId: UserId }>`
      SELECT DISTINCT user_id FROM user_roles WHERE NOT manual
    `.pipe(
      Effect.map((rows) => rows.map(({ userId }) => userId)),
      Effect.withSpan("ModerationRepository.paidRoleHolders"),
    ),

    paidRolesOf: (userId) =>
      paidRolesOf(userId).pipe(
        Effect.map((rows) => rows.map(({ role }) => role)),
        dieOnSchemaError,
        Effect.withSpan("ModerationRepository.paidRolesOf"),
      ),

    recordRoleChange: ({ userId, role, change, by, at }) =>
      recordRoleChange({
        userId,
        role,
        change,
        changedBy: Option.getOrNull(by),
        changedAt: at,
      }).pipe(
        dieOnSchemaError,
        Effect.withSpan("ModerationRepository.recordRoleChange"),
      ),

    roleChangesOf: (userId) =>
      roleChangesOf({ userId }).pipe(
        dieOnSchemaError,
        Effect.withSpan("ModerationRepository.roleChangesOf"),
      ),

    insertActiveRestriction: (restriction) =>
      insertActive(Restriction.insert.make(restriction)).pipe(
        Effect.map(Option.isSome),
        dieOnSchemaError,
        Effect.withSpan("ModerationRepository.insertActiveRestriction"),
      ),

    findActiveRestrictionForUpdate: (userId) =>
      findActive({ userId }).pipe(
        dieOnSchemaError,
        Effect.withSpan("ModerationRepository.findActiveRestrictionForUpdate"),
      ),

    liftRestriction: ({ id, at, by, note }) =>
      lift({
        id,
        liftedAt: at,
        liftedBy: by,
        liftNote: Option.getOrNull(note),
      }).pipe(
        dieOnSchemaError,
        Effect.withSpan("ModerationRepository.liftRestriction"),
      ),

    activeRestrictionsOf: (ids) =>
      Arr.isReadonlyArrayNonEmpty(ids)
        ? activeOf({ ids }).pipe(
            Effect.map(
              (rows) => new Map(rows.map((row) => [row.userId, row] as const)),
            ),
            dieOnSchemaError,
            Effect.withSpan("ModerationRepository.activeRestrictionsOf"),
          )
        : Effect.succeed(new Map()),

    restrictionsOf: (userId) =>
      historyOf({ userId }).pipe(
        dieOnSchemaError,
        Effect.withSpan("ModerationRepository.restrictionsOf"),
      ),

    accessOf: (subject) =>
      accessOf({ subject }).pipe(
        Effect.map(Option.getOrElse(() => ({ roles: [], restricted: false }))),
        dieOnSchemaError,
        Effect.withSpan("ModerationRepository.accessOf"),
      ),
  });
});

/**
 * What decides about a user's requests: their roles, and whether they are
 * blocked. `restricted` is true for a user with an active restriction and for
 * one who deleted their account: neither may log in or use a session.
 */
export interface Access {
  readonly roles: ReadonlyArray<Role>;
  readonly restricted: boolean;
}

/**
 * Storage of roles, the role change log and restrictions. Used only by the
 * commands and queries of the moderation domain.
 */
export class ModerationRepository extends Context.Service<
  ModerationRepository,
  {
    /** The roles of each of these users, sorted; users without roles are absent. */
    readonly rolesOfUsers: (
      ids: ReadonlyArray<UserId>,
    ) => Effect.Effect<
      ReadonlyMap<UserId, ReadonlyArray<Role>>,
      SqlError.SqlError
    >;
    /**
     * Locks every superAdmin grant until the transaction ends and returns
     * who holds it, so concurrent revocations can't remove the last one.
     */
    readonly lockSuperAdmins: Effect.Effect<
      ReadonlyArray<UserId>,
      SqlError.SqlError
    >;
    /** Whether anybody holds the role. */
    readonly isHeld: (role: Role) => Effect.Effect<boolean, SqlError.SqlError>;
    /**
     * Grants the role by hand (`manual`); returns whether the user didn't
     * hold it yet, or held it only through a payment.
     */
    readonly grantRole: (grant: {
      readonly userId: UserId;
      readonly role: Role;
      readonly by: Option.Option<UserId>;
      readonly at: DateTime.Utc;
    }) => Effect.Effect<boolean, SqlError.SqlError>;
    /** Revokes the role; returns whether the user held it. */
    readonly revokeRole: (
      userId: UserId,
      role: Role,
    ) => Effect.Effect<boolean, SqlError.SqlError>;
    /**
     * Grants the role because of a payment (not `manual`); returns whether
     * the user didn't hold it yet. A role they hold already stays as it is.
     */
    readonly grantPaidRole: (grant: {
      readonly userId: UserId;
      readonly role: Role;
      readonly at: DateTime.Utc;
    }) => Effect.Effect<boolean, SqlError.SqlError>;
    /**
     * Revokes the role if the user holds it only through a payment; returns
     * whether it did.
     */
    readonly revokePaidRole: (
      userId: UserId,
      role: Role,
    ) => Effect.Effect<boolean, SqlError.SqlError>;
    /** Who holds a role only through payments. */
    readonly paidRoleHolders: Effect.Effect<
      ReadonlyArray<UserId>,
      SqlError.SqlError
    >;
    /** The roles the user holds only through payments, sorted. */
    readonly paidRolesOf: (
      userId: UserId,
    ) => Effect.Effect<ReadonlyArray<Role>, SqlError.SqlError>;
    readonly recordRoleChange: (change: {
      readonly userId: UserId;
      readonly role: Role;
      readonly change: RoleChangeKind;
      readonly by: Option.Option<UserId>;
      readonly at: DateTime.Utc;
    }) => Effect.Effect<void, SqlError.SqlError>;
    /** The user's role change log, oldest first. */
    readonly roleChangesOf: (
      userId: UserId,
    ) => Effect.Effect<ReadonlyArray<RoleChange>, SqlError.SqlError>;
    /**
     * Stores an active restriction unless the user already has one; returns
     * whether it did.
     */
    readonly insertActiveRestriction: (
      restriction: Restriction,
    ) => Effect.Effect<boolean, SqlError.SqlError>;
    /** The user's active restriction, locked until the transaction ends. */
    readonly findActiveRestrictionForUpdate: (
      userId: UserId,
    ) => Effect.Effect<Option.Option<Restriction>, SqlError.SqlError>;
    /** Lifts the restriction, unless it is lifted already. */
    readonly liftRestriction: (lift: {
      readonly id: RestrictionId;
      readonly at: DateTime.Utc;
      readonly by: UserId;
      readonly note: Option.Option<string>;
    }) => Effect.Effect<void, SqlError.SqlError>;
    /** The active restriction of each of these users, if any. */
    readonly activeRestrictionsOf: (
      ids: ReadonlyArray<UserId>,
    ) => Effect.Effect<ReadonlyMap<UserId, Restriction>, SqlError.SqlError>;
    /** Every restriction of the user, newest first. */
    readonly restrictionsOf: (
      userId: UserId,
    ) => Effect.Effect<ReadonlyArray<Restriction>, SqlError.SqlError>;
    /**
     * Roles and restriction of the user with this OIDC `sub`, in one query;
     * no roles and not restricted for an unknown subject.
     */
    readonly accessOf: (
      subject: typeof Subject.Type,
    ) => Effect.Effect<Access, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/moderation/ModerationRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(ModerationRepository, make);
}
