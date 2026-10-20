import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import type { UserId } from "#domains/users/User";
import { countDeleted, dieOnSchemaError } from "#repositories/Sql";
import { type AuditEntry, AuditAction, AuditRecord } from "./Audit.ts";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insert = SqlSchema.void({
    Request: Schema.Struct({
      at: Schema.DateTimeUtcFromDate,
      action: AuditAction,
      actorId: Schema.NullOr(Schema.String),
      targetId: Schema.NullOr(Schema.String),
      detail: Schema.NullOr(Schema.String),
    }),
    execute: (row) => sql`INSERT INTO audit_log ${sql.insert(row)}`,
  });

  // Newest first by id (keyset). Filtered by user, Postgres combines
  // `audit_log_actor_id_idx` and `audit_log_target_id_idx`; by action it
  // walks `audit_log_action_id_idx` backwards (0015).
  const page = SqlSchema.findAll({
    Request: Schema.Struct({
      limit: Schema.Finite,
      before: Schema.NullOr(Schema.Finite),
      action: Schema.NullOr(Schema.String),
      userId: Schema.NullOr(Schema.String),
    }),
    Result: AuditRecord,
    execute: ({ limit, before, action, userId }) => sql`
      SELECT id::float8 AS id, at, action, actor_id, target_id, detail
      FROM audit_log
      WHERE true
      ${before === null ? sql`` : sql`AND id < ${before}`}
      ${action === null ? sql`` : sql`AND action = ${action}`}
      ${userId === null ? sql`` : sql`AND (actor_id = ${userId} OR target_id = ${userId})`}
      ORDER BY id DESC
      LIMIT ${limit}
    `,
  });

  return AuditRepository.of({
    page: (query) =>
      page({
        limit: query.limit,
        before: Option.getOrNull(query.before),
        action: Option.getOrNull(query.action),
        userId: Option.getOrNull(query.userId),
      }).pipe(dieOnSchemaError, Effect.withSpan("AuditRepository.page")),

    insert: (entry, at) =>
      insert({
        at,
        action: entry.action,
        actorId: Option.getOrNull(entry.actor),
        targetId: Option.getOrNull(entry.target),
        detail: entry.detail ?? null,
      }).pipe(dieOnSchemaError, Effect.withSpan("AuditRepository.insert")),

    deleteBefore: (cutoff) =>
      countDeleted(
        sql,
        sql`DELETE FROM audit_log WHERE at < ${DateTime.toDateUtc(cutoff)}`,
      ).pipe(Effect.withSpan("AuditRepository.deleteBefore")),
  });
});

/** Storage of the audit log. Used only inside the audit domain. */
export class AuditRepository extends Context.Service<
  AuditRepository,
  {
    readonly insert: (
      entry: AuditEntry,
      at: DateTime.Utc,
    ) => Effect.Effect<void, SqlError.SqlError>;
    /** Up to `limit` entries before `before` (an id), newest first, optionally of one action or user. */
    readonly page: (query: {
      readonly limit: number;
      readonly before: Option.Option<number>;
      readonly action: Option.Option<AuditAction>;
      readonly userId: Option.Option<UserId>;
    }) => Effect.Effect<ReadonlyArray<AuditRecord>, SqlError.SqlError>;
    /** Deletes entries older than `cutoff`; returns how many. */
    readonly deleteBefore: (
      cutoff: DateTime.Utc,
    ) => Effect.Effect<number, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/audit/AuditRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(AuditRepository, make);
}
