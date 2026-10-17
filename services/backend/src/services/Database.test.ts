import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { SqlClient } from "effect/sql";
import { readdirSync } from "node:fs";
import { DatabaseTest } from "#testing/Database";
import { migrations } from "./Database.ts";

const migrationsDirectory = new URL("../migrations/", import.meta.url);

describe("migrations", () => {
  it("registers every file in src/migrations, numbered without gaps", () => {
    const files = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .map((file) => file.slice(0, -".ts".length))
      .sort();

    for (const name of files) {
      assert.match(name, /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/);
    }
    assert.deepStrictEqual(
      files.map((name) => Number(name.slice(0, 4))),
      files.map((_, index) => index + 1),
    );
    assert.deepStrictEqual(Object.keys(migrations).sort(), files);
  });
});

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
          "auth_sessions.id_token text not null",
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
            "users_id_pkey: PRIMARY KEY (id)",
            "users_subject_check: CHECK (((char_length(subject) >= 1) AND (char_length(subject) <= 255)))",
            "users_subject_key: UNIQUE (subject)",
          ],
        );

        // Only the indexes backing the primary key and the unique subject.
        const indexes = yield* sql<{ readonly indexname: string }>`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'users'
          ORDER BY indexname
        `;
        assert.deepStrictEqual(
          indexes.map((i) => i.indexname),
          ["users_id_pkey", "users_subject_key"],
        );
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

    it.effect("rejects id hashes that are not 32 bytes long", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const exit = yield* sql`
          INSERT INTO auth_sessions (id_hash, user_id, id_token, claims, expires_at)
          VALUES (${new Uint8Array(31)}, 'user', 'token', '{}', now())
        `.pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
      }),
    );
  });
});
