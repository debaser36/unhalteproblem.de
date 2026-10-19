import { assert, describe, it, layer } from "@effect/vitest";
import { PgliteClient, PgliteMigrator } from "@effect/sql-pglite";
import { Role } from "@unhalteproblem.de/api";
import { Effect, Exit, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { readdirSync } from "node:fs";
import { DatabaseTest } from "#testing/Database";
import { clientOptions, migrations } from "./Database.ts";

const migrationsDirectory = new URL("../migrations/", import.meta.url);

/** Loads the migrations with ids up to `id`. */
const loaderUpTo = (id: number) =>
  PgliteMigrator.fromRecord(
    Object.fromEntries(
      Object.entries(migrations).filter(
        ([key]) => Number(key.slice(0, 4)) <= id,
      ),
    ),
  );

/** A fresh database with the migrations up to `id` applied. */
const databaseUpTo = (id: number) =>
  PgliteMigrator.layer({ loader: loaderUpTo(id) }).pipe(
    Layer.provideMerge(PgliteClient.layer(clientOptions)),
  );

/** `<table>.<column> <type>[ not null][ default …][ generated … as identity]`. */
const describeColumns = (sql: SqlClient.SqlClient, table: string) =>
  sql<{
    readonly columnName: string;
    readonly dataType: string;
    readonly isNullable: "YES" | "NO";
    readonly columnDefault: string | null;
    readonly identityGeneration: string | null;
  }>`
    SELECT column_name, data_type, is_nullable, column_default,
      identity_generation
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `.pipe(
    Effect.map((columns) =>
      columns.map(
        (c) =>
          `${table}.${c.columnName} ${c.dataType}` +
          (c.isNullable === "NO" ? " not null" : "") +
          (c.columnDefault === null ? "" : ` default ${c.columnDefault}`) +
          (c.identityGeneration === null
            ? ""
            : ` generated ${c.identityGeneration.toLowerCase()} as identity`),
      ),
    ),
  );

/** `<name>: <definition>` of every constraint but NOT NULL, by name. */
const describeConstraints = (sql: SqlClient.SqlClient, table: string) =>
  sql<{ readonly conname: string; readonly definition: string }>`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = ${table}::regclass AND contype <> 'n'
    ORDER BY conname
  `.pipe(
    Effect.map((constraints) =>
      constraints.map((c) => `${c.conname}: ${c.definition}`),
    ),
  );

/** The definitions of all indexes of a table, by name. */
const describeIndexes = (sql: SqlClient.SqlClient, table: string) =>
  sql<{ readonly indexdef: string }>`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = ${table}
    ORDER BY indexname
  `.pipe(Effect.map((indexes) => indexes.map((i) => i.indexdef)));

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

    it.effect("creates the user_roles table with the expected columns", () =>
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
          WHERE table_schema = 'public' AND table_name = 'user_roles'
          ORDER BY ordinal_position
        `;
        assert.deepStrictEqual(
          columns.map(
            (c) =>
              `user_roles.${c.columnName} ${c.dataType}` +
              (c.isNullable === "NO" ? " not null" : "") +
              (c.columnDefault === null ? "" : ` default ${c.columnDefault}`),
          ),
          [
            "user_roles.user_id uuid not null",
            "user_roles.role text not null",
            "user_roles.granted_at timestamp with time zone not null default now()",
            // Added by 0004.
            "user_roles.granted_by uuid",
          ],
        );

        const constraints = yield* sql<{
          readonly conname: string;
          readonly definition: string;
        }>`
          SELECT conname, pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
          WHERE conrelid = 'user_roles'::regclass AND contype <> 'n'
          ORDER BY conname
        `;
        assert.deepStrictEqual(
          constraints.map((c) => `${c.conname}: ${c.definition}`),
          [
            // Added by 0004.
            "user_roles_granted_by_fkey: FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL",
            // Derived from the contract: a role added there without a
            // migration fails here.
            `user_roles_role_check: CHECK ((role = ANY (ARRAY[${Role.literals
              .map((role) => `'${role}'::text`)
              .join(", ")}])))`,
            "user_roles_user_id_fkey: FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
            "user_roles_user_id_role_pkey: PRIMARY KEY (user_id, role)",
          ],
        );

        // The primary key leads with user_id and serves the lookup by user.
        // granted_by (0004) is deliberately not indexed.
        const indexes = yield* sql<{ readonly indexname: string }>`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'user_roles'
          ORDER BY indexname
        `;
        assert.deepStrictEqual(
          indexes.map((i) => i.indexname),
          ["user_roles_user_id_role_pkey"],
        );
      }),
    );

    it.effect("accepts the known roles and rejects any other", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const userId = yield* insertUser(sql, "roles-check");
        const grant = (role: string) => sql`
          INSERT INTO user_roles (user_id, role) VALUES (${userId}, ${role})
        `;
        for (const role of ["normalUser", "admin", "superAdmin"]) {
          yield* grant(role);
        }
        for (const role of ["moderator", "Admin", ""]) {
          const error = yield* grant(role).pipe(Effect.flip);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(
            error.reason.cause,
            "constraint",
            "user_roles_role_check",
          );
        }
      }),
    );

    it.effect("rejects granting the same role twice", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const userId = yield* insertUser(sql, "roles-duplicate");
        const grant = sql`
          INSERT INTO user_roles (user_id, role) VALUES (${userId}, 'admin')
        `;
        yield* grant;
        const error = yield* grant.pipe(Effect.flip);
        assert.strictEqual(error.reason._tag, "UniqueViolation");
        if (error.reason._tag === "UniqueViolation") {
          assert.strictEqual(
            error.reason.constraint,
            "user_roles_user_id_role_pkey",
          );
        }
      }),
    );

    it.effect("rejects roles for users that don't exist", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const error = yield* sql`
          INSERT INTO user_roles (user_id, role)
          VALUES (gen_random_uuid(), 'normalUser')
        `.pipe(Effect.flip);
        assert.strictEqual(error.reason._tag, "ConstraintError");
        assert.propertyVal(
          error.reason.cause,
          "constraint",
          "user_roles_user_id_fkey",
        );
      }),
    );

    it.effect("deletes a user's roles together with the user", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const deleted = yield* insertUser(sql, "roles-cascade-deleted");
        const kept = yield* insertUser(sql, "roles-cascade-kept");
        yield* sql`
          INSERT INTO user_roles (user_id, role) VALUES
            (${deleted}, 'normalUser'),
            (${deleted}, 'admin'),
            (${kept}, 'normalUser')
        `;
        yield* sql`DELETE FROM users WHERE id = ${deleted}`;

        const remaining = yield* sql<{ readonly userId: string }>`
          SELECT user_id FROM user_roles
          WHERE user_id IN (${deleted}, ${kept})
        `;
        assert.deepStrictEqual(
          remaining.map((row) => row.userId),
          [kept],
        );
      }),
    );

    it.effect(
      "creates the role log and restriction tables with the expected columns",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          assert.deepStrictEqual(
            yield* describeColumns(sql, "user_role_changes"),
            [
              "user_role_changes.id bigint not null generated always as identity",
              "user_role_changes.user_id uuid not null",
              "user_role_changes.role text not null",
              "user_role_changes.change text not null",
              "user_role_changes.changed_by uuid",
              "user_role_changes.changed_at timestamp with time zone not null",
            ],
          );
          assert.deepStrictEqual(
            yield* describeColumns(sql, "user_restrictions"),
            [
              "user_restrictions.id uuid not null",
              "user_restrictions.user_id uuid not null",
              "user_restrictions.note text not null",
              "user_restrictions.restricted_by uuid",
              "user_restrictions.restricted_at timestamp with time zone not null",
              "user_restrictions.lifted_at timestamp with time zone",
              "user_restrictions.lifted_by uuid",
              "user_restrictions.lift_note text",
            ],
          );
        }),
    );

    it.effect(
      "constrains and indexes the role log and restriction tables",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          assert.deepStrictEqual(
            yield* describeConstraints(sql, "user_role_changes"),
            [
              "user_role_changes_change_check: CHECK ((change = ANY (ARRAY['granted'::text, 'revoked'::text])))",
              "user_role_changes_changed_by_fkey: FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL",
              "user_role_changes_id_pkey: PRIMARY KEY (id)",
              // Derived from the contract, like user_roles_role_check.
              `user_role_changes_role_check: CHECK ((role = ANY (ARRAY[${Role.literals
                .map((role) => `'${role}'::text`)
                .join(", ")}])))`,
              "user_role_changes_user_id_fkey: FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
            ],
          );
          assert.deepStrictEqual(
            yield* describeConstraints(sql, "user_restrictions"),
            [
              "user_restrictions_id_pkey: PRIMARY KEY (id)",
              "user_restrictions_lift_note_check: CHECK (((char_length(lift_note) >= 1) AND (char_length(lift_note) <= 2000)))",
              "user_restrictions_lifted_by_fkey: FOREIGN KEY (lifted_by) REFERENCES users(id) ON DELETE SET NULL",
              "user_restrictions_lifted_check: CHECK ((((lifted_at IS NOT NULL) OR ((lifted_by IS NULL) AND (lift_note IS NULL))) AND ((lifted_at IS NULL) OR (lifted_at >= restricted_at))))",
              "user_restrictions_note_check: CHECK (((char_length(note) >= 1) AND (char_length(note) <= 2000)))",
              "user_restrictions_restricted_by_fkey: FOREIGN KEY (restricted_by) REFERENCES users(id) ON DELETE SET NULL",
              "user_restrictions_user_id_fkey: FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
            ],
          );

          // The actor columns are deliberately not indexed.
          assert.deepStrictEqual(
            yield* describeIndexes(sql, "user_role_changes"),
            [
              "CREATE UNIQUE INDEX user_role_changes_id_pkey ON public.user_role_changes USING btree (id)",
              "CREATE INDEX user_role_changes_user_id_changed_at_idx ON public.user_role_changes USING btree (user_id, changed_at)",
            ],
          );
          assert.deepStrictEqual(
            yield* describeIndexes(sql, "user_restrictions"),
            [
              "CREATE UNIQUE INDEX user_restrictions_active_key ON public.user_restrictions USING btree (user_id) WHERE (lifted_at IS NULL)",
              "CREATE UNIQUE INDEX user_restrictions_id_pkey ON public.user_restrictions USING btree (id)",
              "CREATE INDEX user_restrictions_user_id_restricted_at_idx ON public.user_restrictions USING btree (user_id, restricted_at)",
            ],
          );
        }),
    );

    it.effect("logs the known roles as granted or revoked, nothing else", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const userId = yield* insertUser(sql, "role-changes-check");
        const log = (role: string, change: string) => sql`
          INSERT INTO user_role_changes (user_id, role, change, changed_at)
          VALUES (${userId}, ${role}, ${change}, now())
        `;
        for (const role of Role.literals) {
          yield* log(role, "granted");
          yield* log(role, "revoked");
        }
        for (const role of ["moderator", "Admin", ""]) {
          const error = yield* log(role, "granted").pipe(Effect.flip);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(
            error.reason.cause,
            "constraint",
            "user_role_changes_role_check",
          );
        }
        for (const change of ["grant", "Granted", "deleted", ""]) {
          const error = yield* log("admin", change).pipe(Effect.flip);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(
            error.reason.cause,
            "constraint",
            "user_role_changes_change_check",
          );
        }

        // The log numbers its entries itself.
        const exit = yield* sql`
          INSERT INTO user_role_changes (id, user_id, role, change, changed_at)
          VALUES (1000000, ${userId}, 'admin', 'granted', now())
        `.pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
      }),
    );

    it.effect("keeps at most one active restriction per user", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const userId = yield* insertUser(sql, "restrictions-active");
        const other = yield* insertUser(sql, "restrictions-active-other");
        const restrict = (user: string) => sql<{ readonly id: string }>`
          INSERT INTO user_restrictions (id, user_id, note, restricted_at)
          VALUES (gen_random_uuid(), ${user}, 'spam', now())
          RETURNING id
        `;
        const [first] = yield* restrict(userId);

        const error = yield* restrict(userId).pipe(Effect.flip);
        assert.strictEqual(error.reason._tag, "UniqueViolation");
        if (error.reason._tag === "UniqueViolation") {
          assert.strictEqual(
            error.reason.constraint,
            "user_restrictions_active_key",
          );
        }
        // Other users are restricted independently.
        yield* restrict(other);

        yield* sql`
          UPDATE user_restrictions SET lifted_at = now() WHERE id = ${first.id}
        `;
        yield* restrict(userId);

        const rows = yield* sql<{ readonly active: boolean }>`
          SELECT lifted_at IS NULL AS active FROM user_restrictions
          WHERE user_id = ${userId}
          ORDER BY active
        `;
        assert.deepStrictEqual(rows, [{ active: false }, { active: true }]);
      }),
    );

    it.effect(
      "rejects details of a lift without a lift, or before the restriction",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const userId = yield* insertUser(sql, "restrictions-lifted");
          const actor = yield* insertUser(sql, "restrictions-lifted-actor");
          const insert = (
            liftedAt: string | null,
            liftedBy: string | null,
            liftNote: string | null,
          ) => sql`
          INSERT INTO user_restrictions
            (id, user_id, note, restricted_by, restricted_at, lifted_at, lifted_by, lift_note)
          VALUES (
            gen_random_uuid(), ${userId}, 'note', ${actor},
            '2026-05-01T00:00:00Z', ${liftedAt}, ${liftedBy}, ${liftNote}
          )
        `;

          const rejected: ReadonlyArray<Parameters<typeof insert>> = [
            [null, actor, null],
            [null, null, "lifted"],
            [null, actor, "lifted"],
            ["2026-04-30T23:59:59Z", actor, "lifted"],
          ];
          for (const args of rejected) {
            const error = yield* insert(...args).pipe(Effect.flip);
            assert.strictEqual(error.reason._tag, "ConstraintError");
            assert.propertyVal(
              error.reason.cause,
              "constraint",
              "user_restrictions_lifted_check",
            );
          }

          // Lifted at the moment of the restriction, by a since deleted actor
          // without a note, and still active.
          yield* insert("2026-05-01T00:00:00Z", actor, "lifted");
          yield* insert("2026-05-02T00:00:00Z", null, null);
          yield* insert(null, null, null);
        }),
    );

    it.effect("limits notes to 1 to 2000 characters", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const userId = yield* insertUser(sql, "restrictions-notes");
        // Lifted, so the one-active rule doesn't get in the way.
        const insert = (note: string, liftNote: string | null) => sql`
          INSERT INTO user_restrictions
            (id, user_id, note, restricted_at, lifted_at, lift_note)
          VALUES (gen_random_uuid(), ${userId}, ${note}, now(), now(), ${liftNote})
        `;
        for (const note of ["", "n".repeat(2001)]) {
          const error = yield* insert(note, null).pipe(Effect.flip);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(
            error.reason.cause,
            "constraint",
            "user_restrictions_note_check",
          );
        }
        for (const liftNote of ["", "n".repeat(2001)]) {
          const error = yield* insert("note", liftNote).pipe(Effect.flip);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(
            error.reason.cause,
            "constraint",
            "user_restrictions_lift_note_check",
          );
        }
        // Characters, not bytes.
        yield* insert("n", "n");
        yield* insert("€".repeat(2000), "€".repeat(2000));
      }),
    );

    it.effect("rejects moderation rows that refer to unknown users", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const userId = yield* insertUser(sql, "moderation-unknown");
        const cases = [
          [
            sql`
              UPDATE user_roles SET granted_by = gen_random_uuid()
              WHERE user_id = ${userId}
            `,
            "user_roles_granted_by_fkey",
          ],
          [
            sql`
              INSERT INTO user_role_changes (user_id, role, change, changed_at)
              VALUES (gen_random_uuid(), 'admin', 'granted', now())
            `,
            "user_role_changes_user_id_fkey",
          ],
          [
            sql`
              INSERT INTO user_role_changes
                (user_id, role, change, changed_by, changed_at)
              VALUES (${userId}, 'admin', 'granted', gen_random_uuid(), now())
            `,
            "user_role_changes_changed_by_fkey",
          ],
          [
            sql`
              INSERT INTO user_restrictions (id, user_id, note, restricted_at)
              VALUES (gen_random_uuid(), gen_random_uuid(), 'note', now())
            `,
            "user_restrictions_user_id_fkey",
          ],
          [
            sql`
              INSERT INTO user_restrictions
                (id, user_id, note, restricted_by, restricted_at)
              VALUES (gen_random_uuid(), ${userId}, 'note', gen_random_uuid(), now())
            `,
            "user_restrictions_restricted_by_fkey",
          ],
          [
            sql`
              INSERT INTO user_restrictions
                (id, user_id, note, restricted_at, lifted_at, lifted_by)
              VALUES (
                gen_random_uuid(), ${userId}, 'note', now(), now(), gen_random_uuid()
              )
            `,
            "user_restrictions_lifted_by_fkey",
          ],
        ] as const;
        yield* sql`
          INSERT INTO user_roles (user_id, role) VALUES (${userId}, 'normalUser')
        `;
        for (const [statement, constraint] of cases) {
          const error = yield* statement.pipe(Effect.flip);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(error.reason.cause, "constraint", constraint);
        }
      }),
    );

    it.effect("keeps the moderation history when the actor is deleted", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const target = yield* insertUser(sql, "moderation-actor-target");
        const actor = yield* insertUser(sql, "moderation-actor");
        yield* sql`
          INSERT INTO user_roles (user_id, role, granted_by) VALUES
            (${target}, 'admin', ${actor}),
            (${actor}, 'superAdmin', ${actor})
        `;
        yield* sql`
          INSERT INTO user_role_changes
            (user_id, role, change, changed_by, changed_at)
          VALUES
            (${target}, 'admin', 'granted', ${actor}, now()),
            (${actor}, 'superAdmin', 'granted', ${actor}, now())
        `;
        yield* sql`
          INSERT INTO user_restrictions
            (id, user_id, note, restricted_by, restricted_at, lifted_at, lifted_by)
          VALUES
            (gen_random_uuid(), ${target}, 'first', ${actor}, now(), now(), ${actor}),
            (gen_random_uuid(), ${target}, 'second', ${actor}, now(), NULL, NULL),
            (gen_random_uuid(), ${actor}, 'self', ${actor}, now(), NULL, NULL)
        `;

        yield* sql`DELETE FROM users WHERE id = ${actor}`;

        // The actor's own rows go with them, even where they are also the
        // actor; the target's rows stay without an actor.
        const roles = yield* sql<{
          readonly userId: string;
          readonly grantedBy: string | null;
        }>`
          SELECT user_id, granted_by FROM user_roles
          WHERE user_id IN (${target}, ${actor})
        `;
        assert.deepStrictEqual(roles, [{ userId: target, grantedBy: null }]);

        const changes = yield* sql<{
          readonly userId: string;
          readonly changedBy: string | null;
        }>`
          SELECT user_id, changed_by FROM user_role_changes
          WHERE user_id IN (${target}, ${actor})
        `;
        assert.deepStrictEqual(changes, [{ userId: target, changedBy: null }]);

        const restrictions = yield* sql<{
          readonly userId: string;
          readonly note: string;
          readonly restrictedBy: string | null;
          readonly liftedBy: string | null;
          readonly lifted: boolean;
        }>`
          SELECT user_id, note, restricted_by, lifted_by, lifted_at IS NOT NULL AS lifted
          FROM user_restrictions
          WHERE user_id IN (${target}, ${actor})
          ORDER BY note
        `;
        assert.deepStrictEqual(restrictions, [
          {
            userId: target,
            note: "first",
            restrictedBy: null,
            liftedBy: null,
            lifted: true,
          },
          {
            userId: target,
            note: "second",
            restrictedBy: null,
            liftedBy: null,
            lifted: false,
          },
        ]);
      }),
    );

    it.effect("deletes a user's role log and restrictions with the user", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const deleted = yield* insertUser(sql, "moderation-cascade-deleted");
        const kept = yield* insertUser(sql, "moderation-cascade-kept");
        for (const user of [deleted, kept]) {
          yield* sql`
            INSERT INTO user_role_changes (user_id, role, change, changed_at)
            VALUES (${user}, 'admin', 'granted', now())
          `;
          yield* sql`
            INSERT INTO user_restrictions (id, user_id, note, restricted_at)
            VALUES (gen_random_uuid(), ${user}, 'note', now())
          `;
        }

        yield* sql`DELETE FROM users WHERE id = ${deleted}`;

        const changes = yield* sql<{ readonly userId: string }>`
          SELECT user_id FROM user_role_changes
          WHERE user_id IN (${deleted}, ${kept})
        `;
        assert.deepStrictEqual(
          changes.map((row) => row.userId),
          [kept],
        );
        const restrictions = yield* sql<{ readonly userId: string }>`
          SELECT user_id FROM user_restrictions
          WHERE user_id IN (${deleted}, ${kept})
        `;
        assert.deepStrictEqual(
          restrictions.map((row) => row.userId),
          [kept],
        );
      }),
    );

    it.effect("creates the outbox table with the expected columns", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeColumns(sql, "outbox"), [
          "outbox.id bigint not null generated always as identity",
          "outbox.topic text not null",
          "outbox.payload jsonb not null",
          "outbox.created_at timestamp with time zone not null",
          "outbox.available_at timestamp with time zone not null",
          "outbox.locked_until timestamp with time zone",
          "outbox.attempts integer not null default 0",
          "outbox.last_error text",
          "outbox.dead_at timestamp with time zone",
        ]);
      }),
    );

    it.effect("constrains and indexes the outbox for the claim query", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeConstraints(sql, "outbox"), [
          "outbox_attempts_check: CHECK ((attempts >= 0))",
          "outbox_id_pkey: PRIMARY KEY (id)",
          "outbox_topic_check: CHECK ((char_length(topic) >= 1))",
        ]);
        // Dead rows are deliberately not indexed, neither for claiming nor
        // for purging.
        assert.deepStrictEqual(yield* describeIndexes(sql, "outbox"), [
          "CREATE UNIQUE INDEX outbox_id_pkey ON public.outbox USING btree (id)",
          "CREATE INDEX outbox_topic_available_at_id_idx ON public.outbox USING btree (topic, available_at, id) WHERE (dead_at IS NULL)",
        ]);
      }),
    );

    it.effect("numbers outbox rows itself and starts with no attempts", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = sql<{
          readonly id: string;
          readonly attempts: number;
          readonly lockedUntil: Date | null;
          readonly lastError: string | null;
          readonly deadAt: Date | null;
        }>`
          INSERT INTO outbox (topic, payload, created_at, available_at)
          VALUES ('outbox-defaults', '{"to":"a"}', now(), now())
          RETURNING id, attempts, locked_until, last_error, dead_at
        `;
        const [first] = yield* insert;
        const [second] = yield* insert;
        assert.strictEqual(first.attempts, 0);
        assert.strictEqual(first.lockedUntil, null);
        assert.strictEqual(first.lastError, null);
        assert.strictEqual(first.deadAt, null);
        assert.isTrue(BigInt(second.id) > BigInt(first.id));

        const exit = yield* sql`
          INSERT INTO outbox (id, topic, payload, created_at, available_at)
          VALUES (1000000, 'outbox-defaults', '{}', now(), now())
        `.pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));

        // jsonb keeps nested keys as written, whatever the topic encodes.
        const [row] = yield* sql<{ readonly payload: unknown }>`
          SELECT payload FROM outbox WHERE id = ${first.id}
        `;
        assert.deepStrictEqual(row.payload, { to: "a" });
      }),
    );

    it.effect(
      "rejects empty topics, negative attempts and missing values",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const emptyTopic = yield* sql`
          INSERT INTO outbox (topic, payload, created_at, available_at)
          VALUES ('', '{}', now(), now())
        `.pipe(Effect.flip);
          assert.strictEqual(emptyTopic.reason._tag, "ConstraintError");
          assert.propertyVal(
            emptyTopic.reason.cause,
            "constraint",
            "outbox_topic_check",
          );

          const negativeAttempts = yield* sql`
          INSERT INTO outbox (topic, payload, created_at, available_at, attempts)
          VALUES ('outbox-check', '{}', now(), now(), -1)
        `.pipe(Effect.flip);
          assert.strictEqual(negativeAttempts.reason._tag, "ConstraintError");
          assert.propertyVal(
            negativeAttempts.reason.cause,
            "constraint",
            "outbox_attempts_check",
          );

          // The application sets both timestamps: there is no default.
          for (const statement of [
            sql`
            INSERT INTO outbox (topic, payload, available_at)
            VALUES ('outbox-check', '{}', now())
          `,
            sql`
            INSERT INTO outbox (topic, payload, created_at)
            VALUES ('outbox-check', '{}', now())
          `,
            sql`
            INSERT INTO outbox (topic, created_at, available_at)
            VALUES ('outbox-check', now(), now())
          `,
          ]) {
            // Fails: a NOT NULL violation, no default fills the gap.
            yield* statement.pipe(Effect.flip);
          }
        }),
    );

    it.effect("claims only due, unlocked and living rows of the topic", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const now = "2026-06-01T12:00:00Z";
        const insert = (
          topic: string,
          label: string,
          availableAt: string,
          lockedUntil: string | null,
          deadAt: string | null,
        ) => sql`
          INSERT INTO outbox
            (topic, payload, created_at, available_at, locked_until, dead_at)
          VALUES (
            ${topic}, ${JSON.stringify({ label })}::jsonb, '2026-06-01T00:00:00Z',
            ${availableAt}, ${lockedUntil}, ${deadAt}
          )
        `;
        const topic = "outbox-claim";
        yield* insert(topic, "due", "2026-06-01T12:00:00Z", null, null);
        yield* insert(topic, "future", "2026-06-01T12:00:01Z", null, null);
        yield* insert(
          topic,
          "locked",
          "2026-06-01T00:00:00Z",
          "2026-06-01T12:00:00Z",
          null,
        );
        yield* insert(
          topic,
          "expired",
          "2026-06-01T00:00:00Z",
          "2026-06-01T11:59:59Z",
          null,
        );
        yield* insert(
          topic,
          "dead",
          "2026-06-01T00:00:00Z",
          null,
          "2026-06-01T11:00:00Z",
        );
        yield* insert(
          "outbox-claim-other",
          "other",
          "2026-06-01T00:00:00Z",
          null,
          null,
        );

        const claim = (limit: number) => sql<{
          readonly payload: { readonly label: string };
          readonly attempts: number;
        }>`
          UPDATE outbox SET locked_until = ${now}::timestamptz + interval '30 seconds',
            attempts = attempts + 1
          WHERE id IN (
            SELECT id FROM outbox
            WHERE topic = ${topic} AND dead_at IS NULL
              AND available_at <= ${now}::timestamptz
              AND (locked_until IS NULL OR locked_until < ${now}::timestamptz)
            ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED
          )
          RETURNING payload, attempts
        `;
        // Oldest first; the locked row's lease has not run out at `now`.
        const first = yield* claim(1);
        assert.deepStrictEqual(
          first.map((row) => row.payload.label),
          ["due"],
        );
        const rest = yield* claim(10);
        assert.deepStrictEqual(
          rest.map((row) => row.payload.label),
          ["expired"],
        );
        assert.deepStrictEqual(
          [...first, ...rest].map((row) => row.attempts),
          [1, 1],
        );
        assert.deepStrictEqual(yield* claim(10), []);
      }),
    );

    it.effect("uses the partial index to find due rows of a topic", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The table is tiny, so the planner would prefer a sequential scan.
        const plan = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET LOCAL enable_seqscan = off`;
            return yield* sql<Record<string, string>>`
              EXPLAIN
              SELECT id FROM outbox
              WHERE topic = 'outbox-claim' AND dead_at IS NULL
                AND available_at <= now()
                AND (locked_until IS NULL OR locked_until < now())
              ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED
            `;
          }),
        );
        assert.include(
          plan.flatMap((row) => Object.values(row)).join("\n"),
          "outbox_topic_available_at_id_idx",
        );
      }),
    );

    it.effect(
      "creates the contact_messages table with the expected columns",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          assert.deepStrictEqual(
            yield* describeColumns(sql, "contact_messages"),
            [
              "contact_messages.id uuid not null",
              "contact_messages.name text not null",
              "contact_messages.email text not null",
              "contact_messages.message text not null",
              "contact_messages.created_at timestamp with time zone not null",
            ],
          );
        }),
    );

    it.effect(
      "constrains and indexes contact_messages for the retention job",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          // No foreign keys: senders need no account.
          assert.deepStrictEqual(
            yield* describeConstraints(sql, "contact_messages"),
            [
              "contact_messages_email_check: CHECK (((char_length(email) >= 1) AND (char_length(email) <= 254)))",
              "contact_messages_id_pkey: PRIMARY KEY (id)",
              "contact_messages_message_check: CHECK (((char_length(message) >= 1) AND (char_length(message) <= 5000)))",
              "contact_messages_name_check: CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100)))",
            ],
          );
          assert.deepStrictEqual(
            yield* describeIndexes(sql, "contact_messages"),
            [
              "CREATE INDEX contact_messages_created_at_idx ON public.contact_messages USING btree (created_at)",
              "CREATE UNIQUE INDEX contact_messages_id_pkey ON public.contact_messages USING btree (id)",
            ],
          );
        }),
    );

    it.effect(
      "accepts contact messages at the limits and counts code points",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const insert = (name: string, email: string, message: string) =>
            sql`
            INSERT INTO contact_messages (id, name, email, message, created_at)
            VALUES (gen_random_uuid(), ${name}, ${email}, ${message}, now())
          `;
          yield* insert("n", "e", "m");
          yield* insert("n".repeat(100), "e".repeat(254), "m".repeat(5000));
          // An emoji is two UTF-16 code units but one code point: the database
          // never counts more than the API does.
          yield* insert("😀".repeat(100), "e", "😀".repeat(5000));
        }),
    );

    it.effect("rejects empty and too long contact message values", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = (name: string, email: string, message: string) =>
          sql`
            INSERT INTO contact_messages (id, name, email, message, created_at)
            VALUES (gen_random_uuid(), ${name}, ${email}, ${message}, now())
          `.pipe(Effect.flip);
        const cases = [
          ["", "e", "m", "contact_messages_name_check"],
          ["n".repeat(101), "e", "m", "contact_messages_name_check"],
          ["n", "", "m", "contact_messages_email_check"],
          ["n", "e".repeat(255), "m", "contact_messages_email_check"],
          ["n", "e", "", "contact_messages_message_check"],
          ["n", "e", "m".repeat(5001), "contact_messages_message_check"],
        ] as const;
        for (const [name, email, message, constraint] of cases) {
          const error = yield* insert(name, email, message);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(error.reason.cause, "constraint", constraint);
        }

        // The application sets id and created_at: there is no default.
        for (const statement of [
          sql`
            INSERT INTO contact_messages (name, email, message, created_at)
            VALUES ('n', 'e', 'm', now())
          `,
          sql`
            INSERT INTO contact_messages (id, name, email, message)
            VALUES (gen_random_uuid(), 'n', 'e', 'm')
          `,
        ]) {
          // Fails: a NOT NULL violation, no default fills the gap.
          yield* statement.pipe(Effect.flip);
        }
      }),
    );

    it.effect("uses the created_at index to find old contact messages", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The table is tiny, so the planner would prefer a sequential scan.
        const plan = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET LOCAL enable_seqscan = off`;
            return yield* sql<Record<string, string>>`
              EXPLAIN
              DELETE FROM contact_messages
              WHERE created_at < '2026-01-01T00:00:00Z'::timestamptz
            `;
          }),
        );
        assert.include(
          plan.flatMap((row) => Object.values(row)).join("\n"),
          "contact_messages_created_at_idx",
        );
      }),
    );

    it.effect("purges only contact messages older than the cutoff", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO contact_messages (id, name, email, message, created_at)
          VALUES
            (gen_random_uuid(), 'purge', 'e', 'old', '2025-12-31T23:59:59Z'),
            (gen_random_uuid(), 'purge', 'e', 'new', '2026-01-01T00:00:00Z')
        `;
        yield* sql`
          DELETE FROM contact_messages
          WHERE created_at < ${"2026-01-01T00:00:00Z"}::timestamptz
        `;
        const rows = yield* sql<{ readonly message: string }>`
          SELECT message FROM contact_messages WHERE name = 'purge'
        `;
        assert.deepStrictEqual(
          rows.map((row) => row.message),
          ["new"],
        );
      }),
    );

    it.effect("creates the audit_log table with the expected columns", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // at has no default: the application sets it from the Effect clock.
        assert.deepStrictEqual(yield* describeColumns(sql, "audit_log"), [
          "audit_log.id bigint not null generated always as identity",
          "audit_log.at timestamp with time zone not null",
          "audit_log.action text not null",
          "audit_log.actor_id uuid",
          "audit_log.target_id uuid",
          "audit_log.detail text",
        ]);
      }),
    );

    it.effect("constrains and indexes audit_log for purge and history", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // No foreign keys: the log outlives users and never blocks deleting
        // one.
        assert.deepStrictEqual(yield* describeConstraints(sql, "audit_log"), [
          "audit_log_action_check: CHECK ((action = ANY (ARRAY['login'::text, 'logout'::text, 'login_refused'::text, 'role_granted'::text, 'role_revoked'::text, 'user_restricted'::text, 'restriction_lifted'::text, 'account_deleted'::text])))",
          "audit_log_detail_check: CHECK (((char_length(detail) >= 1) AND (char_length(detail) <= 100)))",
          "audit_log_id_pkey: PRIMARY KEY (id)",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "audit_log"), [
          "CREATE INDEX audit_log_at_idx ON public.audit_log USING btree (at)",
          "CREATE UNIQUE INDEX audit_log_id_pkey ON public.audit_log USING btree (id)",
          "CREATE INDEX audit_log_target_id_idx ON public.audit_log USING btree (target_id, id) WHERE (target_id IS NOT NULL)",
        ]);
      }),
    );

    it.effect("accepts the known actions and rejects any other", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = (action: string) =>
          sql`
            INSERT INTO audit_log (at, action)
            VALUES ('2026-01-01T00:00:00Z', ${action})
          `;
        for (const action of [
          "login",
          "logout",
          "login_refused",
          "role_granted",
          "role_revoked",
          "user_restricted",
          "restriction_lifted",
          "account_deleted",
        ]) {
          yield* insert(action);
        }
        for (const action of ["", "Login", "password_changed"]) {
          const error = yield* insert(action).pipe(Effect.flip);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(
            error.reason.cause,
            "constraint",
            "audit_log_action_check",
          );
        }
      }),
    );

    it.effect("limits details to 1 to 100 characters or NULL", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = (detail: string | null) =>
          sql`
            INSERT INTO audit_log (at, action, detail)
            VALUES ('2026-01-01T00:00:00Z', 'role_granted', ${detail})
          `;
        yield* insert(null);
        yield* insert("a");
        yield* insert("a".repeat(100));
        yield* insert("😀".repeat(100));
        for (const detail of ["", "a".repeat(101)]) {
          const error = yield* insert(detail).pipe(Effect.flip);
          assert.strictEqual(error.reason._tag, "ConstraintError");
          assert.propertyVal(
            error.reason.cause,
            "constraint",
            "audit_log_detail_check",
          );
        }
      }),
    );

    it.effect("numbers audit_log rows itself and requires at", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // ALWAYS identity: an insert cannot choose the id.
        yield* sql`
          INSERT INTO audit_log (id, at, action)
          VALUES (1000, '2026-01-01T00:00:00Z', 'login')
        `.pipe(Effect.flip);
        // The application sets at: there is no default.
        yield* sql`INSERT INTO audit_log (action) VALUES ('login')`.pipe(
          Effect.flip,
        );

        yield* sql`
          INSERT INTO audit_log (at, action)
          VALUES ('2026-01-01T00:00:00Z', 'login'), ('2026-01-01T00:00:00Z', 'logout')
        `;
        const ids = yield* sql<{ readonly id: string | number }>`
          SELECT id FROM audit_log ORDER BY id DESC LIMIT 2
        `;
        assert.strictEqual(Number(ids[0]!.id), Number(ids[1]!.id) + 1);
      }),
    );

    it.effect(
      "keeps the audit_log when the users it mentions are deleted",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          // Ids of users that never existed are fine: there are no foreign
          // keys, so the log never blocks deleting a user.
          yield* sql`
          INSERT INTO audit_log (at, action, actor_id, target_id, detail)
          VALUES (
            '2026-01-01T00:00:00Z', 'role_granted',
            gen_random_uuid(), gen_random_uuid(), 'admin'
          )
        `;
          const references = yield* sql<{ readonly count: string | number }>`
          SELECT count(*) AS count FROM pg_constraint
          WHERE conrelid = 'audit_log'::regclass AND contype = 'f'
        `;
          assert.strictEqual(Number(references[0]!.count), 0);
        }),
    );

    it.effect("uses the at index to purge old audit_log rows", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The table is tiny, so the planner would prefer a sequential scan.
        const plan = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET LOCAL enable_seqscan = off`;
            return yield* sql<Record<string, string>>`
              EXPLAIN
              DELETE FROM audit_log
              WHERE at < '2026-01-01T00:00:00Z'::timestamptz
            `;
          }),
        );
        assert.include(
          plan.flatMap((row) => Object.values(row)).join("\n"),
          "audit_log_at_idx",
        );
      }),
    );

    it.effect("uses the target_id index to page one user's history", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The table is tiny, so the planner would prefer a sequential scan.
        const plan = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET LOCAL enable_seqscan = off`;
            return yield* sql<Record<string, string>>`
              EXPLAIN
              SELECT * FROM audit_log
              WHERE target_id = ${"00000000-0000-4000-8000-000000000000"}::uuid
                AND id > ${0}
              ORDER BY id
              LIMIT 10
            `;
          }),
        );
        const text = plan.flatMap((row) => Object.values(row)).join("\n");
        assert.include(text, "audit_log_target_id_idx");
        // The index delivers the order: no separate sort step.
        assert.notInclude(text, "Sort");
      }),
    );

    it.effect("pages one user's history by id and purges by time", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const user = "00000000-0000-4000-8000-0000000000a1";
        const other = "00000000-0000-4000-8000-0000000000a2";
        yield* sql`
          INSERT INTO audit_log (at, action, actor_id, target_id, detail)
          VALUES
            ('2025-12-31T23:59:59Z', 'login', ${user}, ${user}, NULL),
            ('2026-01-01T00:00:00Z', 'login', ${other}, ${other}, NULL),
            ('2026-01-02T00:00:00Z', 'role_granted', NULL, ${user}, 'admin'),
            ('2026-01-03T00:00:00Z', 'logout', ${user}, ${user}, NULL)
        `;
        const page = (afterId: number) =>
          sql<{ readonly id: string | number; readonly action: string }>`
            SELECT id, action FROM audit_log
            WHERE target_id = ${user}::uuid AND id > ${afterId}
            ORDER BY id
            LIMIT 2
          `;
        const first = yield* page(0);
        assert.deepStrictEqual(
          first.map((row) => row.action),
          ["login", "role_granted"],
        );
        const second = yield* page(Number(first[1]!.id));
        assert.deepStrictEqual(
          second.map((row) => row.action),
          ["logout"],
        );

        yield* sql`
          DELETE FROM audit_log
          WHERE at < ${"2026-01-01T00:00:00Z"}::timestamptz
            AND target_id = ${user}::uuid
        `;
        const rest = yield* sql<{ readonly action: string }>`
          SELECT action FROM audit_log WHERE target_id = ${user}::uuid
          ORDER BY id
        `;
        assert.deepStrictEqual(
          rest.map((row) => row.action),
          ["role_granted", "logout"],
        );
      }),
    );
  });
});

describe("0003_create_user_roles", () => {
  // Runs the migrations before 0003 first, so users can exist before
  // user_roles does.
  const DatabaseBefore0003 = databaseUpTo(2);

  it.effect(
    "gives users who registered earlier the normalUser role",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const alice = yield* insertUser(sql, "backfill-alice");
        const bob = yield* insertUser(sql, "backfill-bob");
        yield* sql`
          UPDATE users SET created_at = '2026-01-02T03:04:05Z'
          WHERE id = ${alice}
        `;

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(3) });
        assert.deepStrictEqual(applied, [[3, "create_user_roles"]]);

        const roles = yield* sql<{
          readonly subject: string;
          readonly role: string;
          readonly matchesCreatedAt: boolean;
        }>`
          SELECT u.subject, r.role, r.granted_at = u.created_at AS matches_created_at
          FROM user_roles r JOIN users u ON u.id = r.user_id
          WHERE r.user_id IN (${alice}, ${bob})
          ORDER BY u.subject
        `;
        assert.deepStrictEqual(roles, [
          {
            subject: "backfill-alice",
            role: "normalUser",
            matchesCreatedAt: true,
          },
          {
            subject: "backfill-bob",
            role: "normalUser",
            matchesCreatedAt: true,
          },
        ]);
      }).pipe(Effect.provide(DatabaseBefore0003)),
    { timeout: 30_000 },
  );
});

describe("0004_add_user_moderation", () => {
  // Runs the migrations before 0004 first, so roles can exist before
  // user_role_changes does.
  const DatabaseBefore0004 = databaseUpTo(3);

  it.effect(
    "starts the role log with the roles granted so far",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const alice = yield* insertUser(sql, "log-backfill-alice");
        const bob = yield* insertUser(sql, "log-backfill-bob");
        yield* sql`
          INSERT INTO user_roles (user_id, role, granted_at) VALUES
            (${bob}, 'normalUser', '2026-03-04T05:06:07Z'),
            (${alice}, 'superAdmin', '2026-02-03T04:05:06Z'),
            (${alice}, 'normalUser', '2026-01-02T03:04:05Z')
        `;

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(4) });
        assert.deepStrictEqual(applied, [[4, "add_user_moderation"]]);

        // One granted entry per role, by the system, in the order granted.
        const log = yield* sql<{
          readonly subject: string;
          readonly role: string;
          readonly change: string;
          readonly changedBy: string | null;
          readonly matchesGrantedAt: boolean;
        }>`
          SELECT u.subject, c.role, c.change, c.changed_by,
            c.changed_at = r.granted_at AS matches_granted_at
          FROM user_role_changes c
          JOIN users u ON u.id = c.user_id
          JOIN user_roles r ON r.user_id = c.user_id AND r.role = c.role
          WHERE c.user_id IN (${alice}, ${bob})
          ORDER BY c.id
        `;
        const granted = (subject: string, role: string) => ({
          subject,
          role,
          change: "granted",
          changedBy: null,
          matchesGrantedAt: true,
        });
        assert.deepStrictEqual(log, [
          granted("log-backfill-alice", "normalUser"),
          granted("log-backfill-alice", "superAdmin"),
          granted("log-backfill-bob", "normalUser"),
        ]);

        // Existing grants have no granter.
        const granters = yield* sql<{ readonly grantedBy: string | null }>`
          SELECT DISTINCT granted_by FROM user_roles
          WHERE user_id IN (${alice}, ${bob})
        `;
        assert.deepStrictEqual(granters, [{ grantedBy: null }]);
      }).pipe(Effect.provide(DatabaseBefore0004)),
    { timeout: 30_000 },
  );
});

describe("0007_drop_session_id_token", () => {
  // Runs the migrations before 0007 first, so a session can still have an
  // id_token before the column is dropped.
  const DatabaseBefore0007 = databaseUpTo(6);

  it.effect(
    "drops id_token and keeps the sessions",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO auth_sessions (id_hash, user_id, id_token, claims, expires_at)
          VALUES (${new Uint8Array(32)}, 'drop-token-user', 'token', '{"a":1}', '2030-01-01T00:00:00Z')
        `;

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(7) });
        assert.deepStrictEqual(applied, [[7, "drop_session_id_token"]]);

        const columns = yield* describeColumns(sql, "auth_sessions");
        assert.isFalse(
          columns.some((c) => c.startsWith("auth_sessions.id_token")),
        );
        const sessions = yield* sql<{
          readonly userId: string;
          readonly claims: unknown;
        }>`
          SELECT user_id, claims FROM auth_sessions
          WHERE user_id = 'drop-token-user'
        `;
        assert.deepStrictEqual(sessions, [
          { userId: "drop-token-user", claims: { a: 1 } },
        ]);
      }).pipe(Effect.provide(DatabaseBefore0007)),
    { timeout: 30_000 },
  );
});

const insertUser = (sql: SqlClient.SqlClient, subject: string) =>
  sql<{ readonly id: string }>`
    INSERT INTO users (id, subject, created_at, updated_at, last_login_at)
    VALUES (gen_random_uuid(), ${subject}, now(), now(), now())
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));
