import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { countDeleted, dieOnSchemaError } from "#repositories/Sql";
import { type AuditEntry, AuditAction } from "./Audit.ts";

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

  return AuditRepository.of({
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
    /** Deletes entries older than `cutoff`; returns how many. */
    readonly deleteBefore: (
      cutoff: DateTime.Utc,
    ) => Effect.Effect<number, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/audit/AuditRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(AuditRepository, make);
}
