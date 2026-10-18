import {
  Cause,
  Context,
  DateTime,
  Effect,
  Layer,
  type Option,
  Schema,
} from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { countDeleted } from "#repositories/Sql";
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

  return ContactRepository.of({
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
    /** Deletes the messages stored before `cutoff`; returns how many. */
    readonly deleteCreatedBefore: (
      cutoff: DateTime.Utc,
    ) => Effect.Effect<number, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/contact/ContactRepository") {
  static readonly layer = Layer.effect(ContactRepository, make);
}
