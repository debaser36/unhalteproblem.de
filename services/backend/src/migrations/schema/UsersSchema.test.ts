import { assert, describe, layer } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { SqlClient } from "effect/sql";
import { migrations } from "#infrastructure/Database";
import { DatabaseTest } from "#testing/Database";
import { describeIndexes, insertUser } from "./Helpers.ts";

describe("DatabaseTest", () => {
  layer(DatabaseTest, { timeout: "30 seconds" })((it) => {
    it.effect("runs all migrations on an empty database", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const applied = yield* sql<{ readonly migrationId: number }>`
          SELECT migration_id FROM effect_sql_migrations ORDER BY migration_id
        `;
        assert.deepStrictEqual(
          applied.map((row) => row.migrationId),
          Object.keys(migrations).map((key) => Number(key.slice(0, 4))),
        );
      }),
    );

    it.effect("creates the auth tables with the expected columns", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const columns = yield* sql<{
          readonly tableName: string;
          readonly columnName: string;
          readonly dataType: string;
          readonly isNullable: "YES" | "NO";
          readonly columnDefault: string | null;
        }>`
          SELECT table_name, column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name LIKE 'auth\_%'
          ORDER BY table_name, ordinal_position
        `;
        const describe = columns.map(
          (c) =>
            `${c.tableName}.${c.columnName} ${c.dataType}` +
            (c.isNullable === "NO" ? " not null" : "") +
            (c.columnDefault === null ? "" : ` default ${c.columnDefault}`),
        );
        assert.deepStrictEqual(describe, [
          "auth_login_attempts.id_hash bytea not null",
          "auth_login_attempts.state text not null",
          "auth_login_attempts.nonce text not null",
          "auth_login_attempts.code_verifier text not null",
          "auth_login_attempts.return_to text not null",
          "auth_login_attempts.created_at timestamp with time zone not null default now()",
          "auth_login_attempts.expires_at timestamp with time zone not null",
          "auth_logout_tokens.jti text not null",
          "auth_logout_tokens.expires_at timestamp with time zone not null",
          "auth_sessions.id_hash bytea not null",
          "auth_sessions.user_id text not null",
          "auth_sessions.provider_session_id text",
          "auth_sessions.claims jsonb not null",
          "auth_sessions.created_at timestamp with time zone not null default now()",
          "auth_sessions.expires_at timestamp with time zone not null",
        ]);
      }),
    );

    it.effect("names constraints and indexes explicitly", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const constraints = yield* sql<{
          readonly conname: string;
          readonly definition: string;
        }>`
          SELECT conname, pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
          WHERE conrelid::regclass::text LIKE 'auth\_%'
            -- Postgres 18 also lists NOT NULL here; the columns test covers it.
            AND contype <> 'n'
          ORDER BY conname
        `;
        assert.deepStrictEqual(
          constraints.map((c) => `${c.conname}: ${c.definition}`),
          [
            "auth_login_attempts_id_hash_check: CHECK ((octet_length(id_hash) = 32))",
            "auth_login_attempts_id_hash_pkey: PRIMARY KEY (id_hash)",
            "auth_logout_tokens_jti_pkey: PRIMARY KEY (jti)",
            "auth_sessions_id_hash_check: CHECK ((octet_length(id_hash) = 32))",
            "auth_sessions_id_hash_pkey: PRIMARY KEY (id_hash)",
          ],
        );

        const indexes = yield* sql<{ readonly indexname: string }>`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public' AND tablename LIKE 'auth\_%'
          ORDER BY indexname
        `;
        assert.deepStrictEqual(
          indexes.map((i) => i.indexname),
          [
            "auth_login_attempts_expires_at_idx",
            "auth_login_attempts_id_hash_pkey",
            "auth_logout_tokens_expires_at_idx",
            "auth_logout_tokens_jti_pkey",
            "auth_sessions_expires_at_idx",
            "auth_sessions_id_hash_pkey",
            "auth_sessions_provider_session_id_idx",
            "auth_sessions_user_id_idx",
          ],
        );
      }),
    );

    it.effect("creates the users table with the expected columns", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const columns = yield* sql<{
          readonly columnName: string;
          readonly dataType: string;
          readonly isNullable: "YES" | "NO";
          readonly columnDefault: string | null;
        }>`
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users'
          ORDER BY ordinal_position
        `;
        assert.deepStrictEqual(
          columns.map(
            (c) =>
              `users.${c.columnName} ${c.dataType}` +
              (c.isNullable === "NO" ? " not null" : "") +
              (c.columnDefault === null ? "" : ` default ${c.columnDefault}`),
          ),
          [
            "users.id uuid not null",
            "users.subject text not null",
            "users.username text",
            "users.name text",
            "users.email text",
            "users.email_verified boolean not null default false",
            "users.created_at timestamp with time zone not null",
            "users.updated_at timestamp with time zone not null",
            "users.last_login_at timestamp with time zone not null",
            // Added by 0010.
            "users.deleted_at timestamp with time zone",
          ],
        );

        const constraints = yield* sql<{
          readonly conname: string;
          readonly definition: string;
        }>`
          SELECT conname, pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
          WHERE conrelid = 'users'::regclass AND contype <> 'n'
          ORDER BY conname
        `;
        assert.deepStrictEqual(
          constraints.map((c) => `${c.conname}: ${c.definition}`),
          [
            // Added by 0011.
            "users_created_at_milliseconds_check: CHECK ((created_at = date_trunc('milliseconds'::text, created_at))) NOT VALID",
            // Added by 0010.
            "users_deleted_check: CHECK (((deleted_at IS NULL) OR ((username IS NULL) AND (name IS NULL) AND (email IS NULL) AND (NOT email_verified))))",
            "users_id_pkey: PRIMARY KEY (id)",
            "users_subject_check: CHECK (((char_length(subject) >= 1) AND (char_length(subject) <= 255)))",
            "users_subject_key: UNIQUE (subject)",
          ],
        );

        // The indexes backing the primary key and the unique subject, and
        // the one for the admin user list (see the next tests).
        const indexes = yield* sql<{ readonly indexname: string }>`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'users'
          ORDER BY indexname
        `;
        assert.deepStrictEqual(
          indexes.map((i) => i.indexname),
          ["users_created_at_id_idx", "users_id_pkey", "users_subject_key"],
        );
      }),
    );

    it.effect("indexes users by created_at and id for the admin list", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeIndexes(sql, "users"), [
          "CREATE INDEX users_created_at_id_idx ON public.users USING btree (created_at, id)",
          "CREATE UNIQUE INDEX users_id_pkey ON public.users USING btree (id)",
          "CREATE UNIQUE INDEX users_subject_key ON public.users USING btree (subject)",
        ]);
      }),
    );

    it.effect("uses the users index to page by keyset", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The table is tiny, so the planner would prefer a sequential scan.
        const plan = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET LOCAL enable_seqscan = off`;
            return yield* sql<Record<string, string>>`
              EXPLAIN
              SELECT * FROM users
              WHERE (created_at, id) > (
                ${"2026-01-01T00:00:00Z"}::timestamptz,
                ${"00000000-0000-4000-8000-000000000000"}::uuid
              )
              ORDER BY created_at, id
              LIMIT 10
            `;
          }),
        );
        const text = plan.flatMap((row) => Object.values(row)).join("\n");
        assert.include(text, "users_created_at_id_idx");
        // The index delivers the order: no separate sort step.
        assert.notInclude(text, "Sort");
      }),
    );

    it.effect("keeps one user per subject", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = (subject: string) => sql<{ readonly id: string }>`
          INSERT INTO users (id, subject, created_at, updated_at, last_login_at)
          VALUES (gen_random_uuid(), ${subject}, now(), now(), now())
          ON CONFLICT (subject) DO NOTHING
          RETURNING id
        `;
        assert.strictEqual((yield* insert("unique-subject")).length, 1);
        assert.strictEqual((yield* insert("unique-subject")).length, 0);

        const error = yield* sql`
          INSERT INTO users (id, subject, created_at, updated_at, last_login_at)
          VALUES (gen_random_uuid(), 'unique-subject', now(), now(), now())
        `.pipe(Effect.flip);
        assert.strictEqual(error.reason._tag, "UniqueViolation");
        if (error.reason._tag === "UniqueViolation") {
          assert.strictEqual(error.reason.constraint, "users_subject_key");
        }
      }),
    );

    it.effect("rejects subjects that are empty or longer than 255", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = (subject: string) => sql`
          INSERT INTO users (id, subject, created_at, updated_at, last_login_at)
          VALUES (gen_random_uuid(), ${subject}, now(), now(), now())
        `;
        for (const subject of ["", "s".repeat(256)]) {
          const error = yield* insert(subject).pipe(Effect.flip);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(
            error.reason.cause,
            "constraint",
            "users_subject_check",
          );
        }
        yield* insert("s".repeat(255));
      }),
    );

    it.effect("accepts only anonymised rows with a deleted_at", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const userId = yield* insertUser(sql, "deleted-check");
        const [{ deletedAt }] = yield* sql<{ readonly deletedAt: Date | null }>`
          SELECT deleted_at FROM users WHERE id = ${userId}
        `;
        assert.strictEqual(deletedAt, null);

        // Profile data may stay as long as the user is not deleted.
        yield* sql`
          UPDATE users
          SET username = 'u', name = 'n', email = 'e', email_verified = true
          WHERE id = ${userId}
        `;

        const rejected = [
          sql`UPDATE users SET deleted_at = now() WHERE id = ${userId}`,
          sql`
            UPDATE users
            SET deleted_at = now(), username = NULL, name = NULL, email = NULL
            WHERE id = ${userId}
          `,
          sql`
            UPDATE users
            SET deleted_at = now(), username = NULL, name = 'n', email = NULL,
              email_verified = false
            WHERE id = ${userId}
          `,
        ];
        for (const statement of rejected) {
          const error = yield* statement.pipe(Effect.flip);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(
            error.reason.cause,
            "constraint",
            "users_deleted_check",
          );
        }

        yield* sql`
          UPDATE users
          SET deleted_at = now(), username = NULL, name = NULL, email = NULL,
            email_verified = false
          WHERE id = ${userId}
        `;
        const [row] = yield* sql<{ readonly deleted: boolean }>`
          SELECT deleted_at IS NOT NULL AS deleted FROM users
          WHERE id = ${userId}
        `;
        assert.isTrue(row.deleted);
      }),
    );

    it.effect("rejects users.created_at with sub-millisecond precision", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = (createdAt: string) => sql`
          INSERT INTO users (id, subject, created_at, updated_at, last_login_at)
          VALUES (
            gen_random_uuid(), ${`ms-${createdAt}`}, ${createdAt}::timestamptz,
            now(), now()
          )
        `;

        yield* insert("2026-01-01 00:00:00.001+00");
        yield* insert("2026-01-01 00:00:00+00");

        for (const createdAt of [
          "2026-01-01 00:00:00.000001+00",
          "2026-01-01 00:00:00.0015+00",
        ]) {
          const error = yield* insert(createdAt).pipe(Effect.flip);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(
            error.reason.cause,
            "constraint",
            "users_created_at_milliseconds_check",
          );
        }

        // Updates are checked as well.
        const error = yield* sql`
          UPDATE users SET created_at = '2026-01-01 00:00:00.000001+00'
          WHERE subject = ${"ms-2026-01-01 00:00:00+00"}
        `.pipe(Effect.flip);
        assert.propertyVal(
          error.reason.cause,
          "constraint",
          "users_created_at_milliseconds_check",
        );
      }),
    );

    it.effect("leaves users_created_at_milliseconds_check not validated", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // NOT VALID: existing rows are not scanned at deploy time. An
        // operator may run VALIDATE CONSTRAINT later.
        const [row] = yield* sql<{ readonly convalidated: boolean }>`
          SELECT convalidated FROM pg_constraint
          WHERE conrelid = 'users'::regclass
            AND conname = 'users_created_at_milliseconds_check'
        `;
        assert.isFalse(row.convalidated);
      }),
    );

    it.effect("rejects id hashes that are not 32 bytes long", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const exit = yield* sql`
          INSERT INTO auth_sessions (id_hash, user_id, claims, expires_at)
          VALUES (${new Uint8Array(31)}, 'user', '{}', now())
        `.pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
      }),
    );
  });
});
