import {
  Cause,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Schema,
} from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { countDeleted } from "#infrastructure/Sql";
import { type ContactMessageId, StoredContactMessage } from "./Contact.ts";

/**
 * Replaces any failure of a statement that carries a contact message by a
 * defect that says only which statement failed and the kind of failure.
 * The usual causes quote the row: a `SchemaError` the offending value, and
 * a Postgres constraint violation its "Failing row contains (…)" detail.
 * Logged in full they would put names, addresses and message text into the
 * log. Interruptions pass through.
 */
const scrubbed =
  (statement: string) =>
  <A, R>(
    self: Effect.Effect<A, SqlError.SqlError | Schema.SchemaError, R>,
  ): Effect.Effect<A, never, R> =>
    Effect.catchCause(self, (cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
      const error = Cause.findError(cause);
      const kind =
        error._tag === "Failure"
          ? "defect"
          : error.success._tag === "SqlError"
            ? error.success.reason._tag
            : error.success._tag;
      return Effect.die(
        new Error(`ContactRepository.${statement} failed (${kind})`),
      );
    });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insert = SqlSchema.void({
    Request: StoredContactMessage,
    execute: (row) => sql`INSERT INTO contact_messages ${sql.insert(row)}`,
  });

  const find = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: StoredContactMessage,
    execute: (id) => sql`SELECT * FROM contact_messages WHERE id = ${id}`,
  });

  // Newest first; the position is the (created_at, id) of the last message
  // seen. The table holds at most `CONTACT_RETENTION` worth of messages,
  // so `contact_messages_created_at_idx` is plenty.
  const page = SqlSchema.findAll({
    Request: Schema.Struct({
      limit: Schema.Finite,
      after: Schema.NullOr(
        Schema.Struct({
          createdAt: Schema.DateTimeUtcFromDate,
          id: Schema.String,
        }),
      ),
    }),
    Result: StoredContactMessage,
    execute: ({ limit, after }) => sql`
      SELECT * FROM contact_messages
      ${after === null ? sql`` : sql`WHERE (created_at, id) < (${after.createdAt}, ${after.id}::uuid)`}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `,
  });

  const remove = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Schema.Struct({ id: Schema.String }),
    execute: (id) =>
      sql`DELETE FROM contact_messages WHERE id = ${id} RETURNING id`,
  });

  return ContactRepository.of({
    page: (query) =>
      page({ limit: query.limit, after: Option.getOrNull(query.after) }).pipe(
        scrubbed("page"),
        Effect.withSpan("ContactRepository.page"),
      ),
    deleteById: (id) =>
      remove(id).pipe(
        Effect.map(Option.isSome),
        scrubbed("deleteById"),
        Effect.withSpan("ContactRepository.deleteById"),
      ),
    insert: (message) =>
      insert(message).pipe(
        scrubbed("insert"),
        Effect.withSpan("ContactRepository.insert"),
      ),
    findById: (id) =>
      find(id).pipe(
        scrubbed("findById"),
        Effect.withSpan("ContactRepository.findById"),
      ),
    deleteCreatedBefore: (cutoff) =>
      countDeleted(
        sql,
        sql`DELETE FROM contact_messages WHERE created_at < ${DateTime.toDateUtc(cutoff)}`,
      ).pipe(Effect.withSpan("ContactRepository.deleteCreatedBefore")),
  });
});

/**
 * Storage of contact messages. Used only inside the contact domain. The
 * table holds personal data: nothing here or in its callers logs it, and
 * failures of the statements that carry a message are scrubbed of it (see
 * `scrubbed`); they are defects, as the boundaries would make them anyway.
 */
export class ContactRepository extends Context.Service<
  ContactRepository,
  {
    readonly insert: (message: StoredContactMessage) => Effect.Effect<void>;
    readonly findById: (
      id: ContactMessageId,
    ) => Effect.Effect<Option.Option<StoredContactMessage>>;
    /** Up to `limit` messages, newest first, after the one at `after`. */
    readonly page: (query: {
      readonly limit: number;
      readonly after: Option.Option<{
        readonly createdAt: DateTime.Utc;
        readonly id: ContactMessageId;
      }>;
    }) => Effect.Effect<ReadonlyArray<StoredContactMessage>>;
    /** Deletes one message; whether it existed. */
    readonly deleteById: (id: ContactMessageId) => Effect.Effect<boolean>;
    /** Deletes the messages stored before `cutoff`; returns how many. */
    readonly deleteCreatedBefore: (
      cutoff: DateTime.Utc,
    ) => Effect.Effect<number, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/contact/ContactRepository") {
  static readonly layer = Layer.effect(ContactRepository, make);
}
