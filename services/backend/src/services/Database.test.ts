import { assert, describe, it, layer } from "@effect/vitest";
import { PgliteClient, PgliteMigrator } from "@effect/sql-pglite";
import { Effect, Exit, Layer } from "effect";
import { SqlClient, Statement } from "effect/sql";
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

/** The fixed roles of the contract's `Role`, as the role checks list them. */
const fixedRoles = ["normalUser", "admin", "superAdmin"] as const;

/**
 * user_roles_role_check and user_role_changes_role_check since 0012: a fixed
 * role or `blogEditor:<slug>`, as Postgres prints the definition.
 */
const roleCheck =
  `CHECK (((role = ANY (ARRAY[${fixedRoles.map((role) => `'${role}'::text`).join(", ")}]))` +
  ` OR ((role ~ '^blogEditor:[a-z0-9]+(-[a-z0-9]+)*$'::text)` +
  ` AND (char_length(role) <= 75))))`;

/** Roles of the form `blogEditor:<slug>` that the role checks accept. */
const validBlogEditorRoles = [
  "blogEditor:rust-notes",
  "blogEditor:a",
  "blogEditor:2026",
  "blogEditor:a1-b2-c3",
  // The longest slug, 64 characters.
  `blogEditor:${"a".repeat(64)}`,
];

/** Malformed `blogEditor:` roles that the role checks reject. */
const invalidBlogEditorRoles = [
  // No slug.
  "blogEditor:",
  // Not lowercase ASCII letters and digits.
  "blogEditor:Rust",
  "blogEditor:a_b",
  "blogEditor:a b",
  "blogEditor:ä",
  // Hyphens only between groups.
  "blogEditor:-a",
  "blogEditor:a-",
  "blogEditor:a--b",
  // The prefix is case sensitive and anchored.
  "blogeditor:x",
  "BlogEditor:x",
  " blogEditor:x",
  "xblogEditor:x",
  "blogEditor:x\n",
  // A slug of 65 characters.
  `blogEditor:${"a".repeat(65)}`,
];

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
            // Replaced by 0012.
            `user_roles_role_check: ${roleCheck}`,
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

    it.effect(
      "accepts the fixed and blogEditor roles and rejects any other",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const userId = yield* insertUser(sql, "roles-check");
          const grant = (role: string) => sql`
          INSERT INTO user_roles (user_id, role) VALUES (${userId}, ${role})
        `;
          for (const role of [...fixedRoles, ...validBlogEditorRoles]) {
            yield* grant(role);
          }
          for (const role of [
            "moderator",
            "Admin",
            "",
            ...invalidBlogEditorRoles,
          ]) {
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
              // Replaced by 0012, like user_roles_role_check.
              `user_role_changes_role_check: ${roleCheck}`,
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

    it.effect("logs the fixed and blogEditor roles as granted or revoked", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const userId = yield* insertUser(sql, "role-changes-check");
        const log = (role: string, change: string) => sql`
          INSERT INTO user_role_changes (user_id, role, change, changed_at)
          VALUES (${userId}, ${role}, ${change}, now())
        `;
        for (const role of [...fixedRoles, ...validBlogEditorRoles]) {
          yield* log(role, "granted");
          yield* log(role, "revoked");
        }
        for (const role of [
          "moderator",
          "Admin",
          "",
          ...invalidBlogEditorRoles,
        ]) {
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

    it.effect("creates the blogs, media and blog_posts tables", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The timestamps have no default: the application sets them from the
        // Effect clock.
        assert.deepStrictEqual(yield* describeColumns(sql, "blogs"), [
          "blogs.id uuid not null",
          "blogs.slug text not null",
          "blogs.title text not null",
          "blogs.description text not null",
          "blogs.created_at timestamp with time zone not null",
          "blogs.created_by uuid",
          "blogs.updated_at timestamp with time zone not null",
        ]);
        assert.deepStrictEqual(yield* describeColumns(sql, "media"), [
          "media.id uuid not null",
          "media.content_type text not null",
          "media.data bytea not null",
          "media.byte_size integer not null",
          "media.sha256 bytea not null",
          "media.scope text not null",
          "media.uploaded_by uuid",
          "media.uploaded_at timestamp with time zone not null",
        ]);
        assert.deepStrictEqual(yield* describeColumns(sql, "blog_posts"), [
          "blog_posts.id uuid not null",
          "blog_posts.blog_id uuid not null",
          "blog_posts.slug text not null",
          "blog_posts.title text not null",
          "blog_posts.summary text not null",
          "blog_posts.tags ARRAY not null default '{}'::text[]",
          "blog_posts.cover_media_id uuid",
          "blog_posts.content jsonb not null",
          "blog_posts.status text not null",
          "blog_posts.published_at timestamp with time zone",
          "blog_posts.author_id uuid",
          "blog_posts.updated_by uuid",
          "blog_posts.created_at timestamp with time zone not null",
          "blog_posts.updated_at timestamp with time zone not null",
          "blog_posts.version integer not null default 1",
        ]);
      }),
    );

    it.effect("constrains and indexes blogs, media and blog_posts", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeConstraints(sql, "blogs"), [
          "blogs_created_by_fkey: FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL",
          "blogs_description_check: CHECK (((char_length(description) <= 1000) AND (description !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
          "blogs_id_pkey: PRIMARY KEY (id)",
          "blogs_slug_check: CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (char_length(slug) <= 64)))",
          "blogs_slug_key: UNIQUE (slug)",
          "blogs_title_check: CHECK ((((char_length(title) >= 1) AND (char_length(title) <= 120)) AND (title !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "blogs"), [
          "CREATE UNIQUE INDEX blogs_id_pkey ON public.blogs USING btree (id)",
          "CREATE UNIQUE INDEX blogs_slug_key ON public.blogs USING btree (slug)",
        ]);
        assert.deepStrictEqual(yield* describeConstraints(sql, "media"), [
          "media_byte_size_check: CHECK ((((byte_size >= 1) AND (byte_size <= 5242880)) AND (byte_size = octet_length(data))))",
          "media_content_type_check: CHECK ((content_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/webp'::text, 'image/gif'::text, 'image/avif'::text])))",
          "media_id_pkey: PRIMARY KEY (id)",
          "media_scope_check: CHECK (((scope ~ '^(blog:[a-z0-9]+(-[a-z0-9]+)*|projects)$'::text) AND (char_length(scope) <= 69)))",
          "media_sha256_check: CHECK ((sha256 = sha256(data)))",
          "media_uploaded_by_fkey: FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "media"), [
          "CREATE UNIQUE INDEX media_id_pkey ON public.media USING btree (id)",
          "CREATE INDEX media_scope_uploaded_at_idx ON public.media USING btree (scope, uploaded_at)",
        ]);
        assert.deepStrictEqual(yield* describeConstraints(sql, "blog_posts"), [
          "blog_posts_author_id_fkey: FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL",
          "blog_posts_blog_id_fkey: FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE RESTRICT",
          "blog_posts_blog_id_slug_key: UNIQUE (blog_id, slug)",
          `blog_posts_content_check: CHECK ((content @> '{"type": "doc"}'::jsonb))`,
          "blog_posts_cover_media_id_fkey: FOREIGN KEY (cover_media_id) REFERENCES media(id) ON DELETE SET NULL",
          "blog_posts_id_pkey: PRIMARY KEY (id)",
          "blog_posts_published_at_check: CHECK (((status = 'draft'::text) OR (published_at IS NOT NULL)))",
          "blog_posts_published_at_milliseconds_check: CHECK ((published_at = date_trunc('milliseconds'::text, published_at)))",
          "blog_posts_slug_check: CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (char_length(slug) <= 128)))",
          "blog_posts_status_check: CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])))",
          "blog_posts_summary_check: CHECK (((char_length(summary) <= 500) AND (summary !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
          "blog_posts_tags_check: CHECK (((cardinality(tags) <= 10) AND blog_posts_tags_valid(tags)))",
          "blog_posts_title_check: CHECK ((((char_length(title) >= 1) AND (char_length(title) <= 200)) AND (title !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
          "blog_posts_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL",
          "blog_posts_version_check: CHECK ((version >= 1))",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "blog_posts"), [
          "CREATE INDEX blog_posts_blog_id_published_at_id_idx ON public.blog_posts USING btree (blog_id, published_at DESC, id DESC) WHERE (status = 'published'::text)",
          "CREATE UNIQUE INDEX blog_posts_blog_id_slug_key ON public.blog_posts USING btree (blog_id, slug)",
          "CREATE INDEX blog_posts_blog_id_updated_at_idx ON public.blog_posts USING btree (blog_id, updated_at DESC)",
          "CREATE UNIQUE INDEX blog_posts_id_pkey ON public.blog_posts USING btree (id)",
          "CREATE INDEX blog_posts_published_at_id_idx ON public.blog_posts USING btree (published_at DESC, id DESC) WHERE (status = 'published'::text)",
          "CREATE INDEX blog_posts_tags_idx ON public.blog_posts USING gin (tags)",
        ]);
        // The tag rules a check cannot hold without a subquery.
        const [tagsValid] = yield* sql<{ readonly volatility: string }>`
          SELECT provolatile AS volatility FROM pg_proc
          WHERE proname = 'blog_posts_tags_valid'
        `;
        assert.deepStrictEqual(tagsValid, { volatility: "i" });
      }),
    );

    it.effect("accepts valid blogs and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = (slug: string, title: string, description: string) =>
          sql`
            INSERT INTO blogs (id, slug, title, description, created_at, updated_at)
            VALUES (gen_random_uuid(), ${slug}, ${title}, ${description}, now(), now())
          `;
        yield* insert("check-a", "T", "");
        yield* insert(
          `check-${"a".repeat(58)}`,
          "t".repeat(120),
          "d".repeat(1000),
        );
        // Code points, not UTF-16 code units; inner whitespace is fine.
        yield* insert("check-2026-b", "😀".repeat(120), "😀 \n😀".repeat(250));

        const cases = [
          ["", "T", "", "blogs_slug_check"],
          ["Check", "T", "", "blogs_slug_check"],
          ["check--c", "T", "", "blogs_slug_check"],
          ["check-c-", "T", "", "blogs_slug_check"],
          ["check-ä", "T", "", "blogs_slug_check"],
          [`check-${"a".repeat(59)}`, "T", "", "blogs_slug_check"],
          ["check-c", "", "", "blogs_title_check"],
          ["check-c", "t".repeat(121), "", "blogs_title_check"],
          ["check-c", " T", "", "blogs_title_check"],
          ["check-c", "T\n", "", "blogs_title_check"],
          ["check-c", "T", "d".repeat(1001), "blogs_description_check"],
          ["check-c", "T", "d\t", "blogs_description_check"],
          ["check-c", "T", " ", "blogs_description_check"],
        ] as const;
        for (const [slug, title, description, constraint] of cases) {
          const error = yield* insert(slug, title, description).pipe(
            Effect.flip,
          );
          assert.strictEqual(error.reason._tag, "ConstraintError", constraint);
          assert.propertyVal(error.reason.cause, "constraint", constraint);
        }

        const duplicate = yield* insert("check-a", "Other", "").pipe(
          Effect.flip,
        );
        assert.strictEqual(duplicate.reason._tag, "UniqueViolation");
        if (duplicate.reason._tag === "UniqueViolation") {
          assert.strictEqual(duplicate.reason.constraint, "blogs_slug_key");
        }
      }),
    );

    it.effect("accepts valid media and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const valid = yield* insertMedia(sql, "projects");
        yield* insertMedia(sql, "blog:rust-notes");
        yield* insertMedia(sql, `blog:${"a".repeat(64)}`);
        // The largest upload, 5 MiB, built in the database.
        yield* sql`
          INSERT INTO media
            (id, content_type, data, byte_size, sha256, scope, uploaded_at)
          SELECT gen_random_uuid(), 'image/webp', d, octet_length(d),
            sha256(d), 'projects', now()
          FROM (SELECT convert_to(repeat('a', 5242880), 'UTF8') AS d) AS upload
        `;

        /** Inserts a copy of the valid row with one expression changed. */
        const insertWith = (
          column: "content_type" | "byte_size" | "sha256" | "scope" | "data",
          value: Statement.Fragment,
        ) => {
          const columns = {
            content_type: sql`content_type`,
            data: sql`data`,
            byte_size: sql`byte_size`,
            sha256: sql`sha256`,
            scope: sql`scope`,
          };
          return sql`
            INSERT INTO media
              (id, content_type, data, byte_size, sha256, scope, uploaded_at)
            SELECT gen_random_uuid(),
              ${column === "content_type" ? value : columns.content_type},
              ${column === "data" ? value : columns.data},
              ${column === "byte_size" ? value : columns.byte_size},
              ${column === "sha256" ? value : columns.sha256},
              ${column === "scope" ? value : columns.scope},
              uploaded_at
            FROM media WHERE id = ${valid}
          `.pipe(Effect.flip);
        };
        const cases = [
          ["content_type", sql`'image/svg+xml'`, "media_content_type_check"],
          ["content_type", sql`'IMAGE/PNG'`, "media_content_type_check"],
          ["byte_size", sql`byte_size + 1`, "media_byte_size_check"],
          ["byte_size", sql`0`, "media_byte_size_check"],
          ["sha256", sql`sha256(data || '\\x00'::bytea)`, "media_sha256_check"],
          [
            "sha256",
            sql`substring(sha256 from 1 for 31)`,
            "media_sha256_check",
          ],
          ["scope", sql`'blog:'`, "media_scope_check"],
          ["scope", sql`'blog:Rust'`, "media_scope_check"],
          ["scope", sql`'blog:a--b'`, "media_scope_check"],
          ["scope", sql`'project'`, "media_scope_check"],
          ["scope", sql`'projects:x'`, "media_scope_check"],
          ["scope", sql`'blog:' || repeat('a', 65)`, "media_scope_check"],
        ] as const;
        for (const [column, value, constraint] of cases) {
          const error = yield* insertWith(column, value);
          assert.strictEqual(error.reason._tag, "ConstraintError", constraint);
          assert.propertyVal(error.reason.cause, "constraint", constraint);
        }

        // Empty data: byte_size cannot be 0, so no size matches.
        const empty = yield* sql`
          INSERT INTO media
            (id, content_type, data, byte_size, sha256, scope, uploaded_at)
          VALUES (gen_random_uuid(), 'image/png', ''::bytea, 0,
            sha256(''::bytea), 'projects', now())
        `.pipe(Effect.flip);
        assert.propertyVal(
          empty.reason.cause,
          "constraint",
          "media_byte_size_check",
        );

        // One byte over 5 MiB.
        const tooLarge = yield* sql`
          INSERT INTO media
            (id, content_type, data, byte_size, sha256, scope, uploaded_at)
          SELECT gen_random_uuid(), 'image/png', d, octet_length(d),
            sha256(d), 'projects', now()
          FROM (SELECT convert_to(repeat('a', 5242881), 'UTF8') AS d) AS upload
        `.pipe(Effect.flip);
        assert.propertyVal(
          tooLarge.reason.cause,
          "constraint",
          "media_byte_size_check",
        );
      }),
    );

    it.effect("accepts valid posts and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const blogId = yield* insertBlog(sql, "post-checks");
        const otherBlogId = yield* insertBlog(sql, "post-checks-other");

        yield* insertPost(sql, { blogId, slug: "a" });
        yield* insertPost(sql, {
          blogId,
          slug: `b-${"a".repeat(126)}`,
          title: "😀".repeat(200),
          summary: "s".repeat(500),
          tags: Array.from({ length: 10 }, (_, i) => `tag-${i}`),
          status: "published",
          publishedAt: "2026-01-01T00:00:00.123Z",
          version: 7,
        });
        yield* insertPost(sql, { blogId, slug: "c", tags: ["t".repeat(32)] });
        // Unpublished again: a draft keeps its first publication time.
        yield* insertPost(sql, {
          blogId,
          slug: "d",
          publishedAt: "2026-01-01T00:00:00Z",
        });
        // The slug is unique per subblog only.
        yield* insertPost(sql, { blogId: otherBlogId, slug: "a" });

        const cases = [
          [{ slug: "" }, "blog_posts_slug_check"],
          [{ slug: "A" }, "blog_posts_slug_check"],
          [{ slug: "a_b" }, "blog_posts_slug_check"],
          [{ slug: "a".repeat(129) }, "blog_posts_slug_check"],
          [{ title: "" }, "blog_posts_title_check"],
          [{ title: "t".repeat(201) }, "blog_posts_title_check"],
          [{ title: "T " }, "blog_posts_title_check"],
          [{ summary: "s".repeat(501) }, "blog_posts_summary_check"],
          [{ summary: "\rs" }, "blog_posts_summary_check"],
          [
            { tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`) },
            "blog_posts_tags_check",
          ],
          [{ tags: ["rust", "rust"] }, "blog_posts_tags_check"],
          [{ tags: ["Rust"] }, "blog_posts_tags_check"],
          [{ tags: [""] }, "blog_posts_tags_check"],
          [{ tags: ["a--b"] }, "blog_posts_tags_check"],
          [{ tags: ["t".repeat(33)] }, "blog_posts_tags_check"],
          [{ tags: ["rust", null] }, "blog_posts_tags_check"],
          [{ content: [] }, "blog_posts_content_check"],
          [
            { content: [{ type: "doc", content: [] }] },
            "blog_posts_content_check",
          ],
          [{ content: "doc" }, "blog_posts_content_check"],
          [{ content: { type: "paragraph" } }, "blog_posts_content_check"],
          [{ content: { content: [] } }, "blog_posts_content_check"],
          [
            { status: "deleted", publishedAt: "2026-01-01T00:00:00Z" },
            "blog_posts_status_check",
          ],
          [{ status: "published" }, "blog_posts_published_at_check"],
          [
            { publishedAt: "2026-01-01T00:00:00.000001Z" },
            "blog_posts_published_at_milliseconds_check",
          ],
          [{ version: 0 }, "blog_posts_version_check"],
        ] as const;
        for (const [post, constraint] of cases) {
          const error = yield* insertPost(sql, {
            blogId,
            slug: "invalid",
            ...post,
          }).pipe(
            Effect.tap(() =>
              Effect.sync(() => assert.fail(`accepted: ${constraint}`)),
            ),
            Effect.flip,
          );
          assert.strictEqual(error.reason._tag, "ConstraintError", constraint);
          assert.propertyVal(error.reason.cause, "constraint", constraint);
        }

        // A two-dimensional array of valid, distinct tags.
        const nested = yield* sql`
          UPDATE blog_posts SET tags = '{{a,b},{c,d}}'
          WHERE blog_id = ${blogId} AND slug = 'a'
        `.pipe(Effect.flip);
        assert.propertyVal(
          nested.reason.cause,
          "constraint",
          "blog_posts_tags_check",
        );

        const duplicate = yield* insertPost(sql, { blogId, slug: "a" }).pipe(
          Effect.flip,
        );
        assert.strictEqual(duplicate.reason._tag, "UniqueViolation");
        if (duplicate.reason._tag === "UniqueViolation") {
          assert.strictEqual(
            duplicate.reason.constraint,
            "blog_posts_blog_id_slug_key",
          );
        }

        const unknownBlog = yield* insertPost(sql, {
          blogId: "00000000-0000-4000-8000-000000000b01",
          slug: "a",
        }).pipe(Effect.flip);
        assert.propertyVal(
          unknownBlog.reason.cause,
          "constraint",
          "blog_posts_blog_id_fkey",
        );
        const unknownCover = yield* insertPost(sql, {
          blogId,
          slug: "e",
          coverMediaId: "00000000-0000-4000-8000-000000000b02",
        }).pipe(Effect.flip);
        assert.propertyVal(
          unknownCover.reason.cause,
          "constraint",
          "blog_posts_cover_media_id_fkey",
        );
      }),
    );

    it.effect("keeps blogs, media and posts when their users are deleted", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const admin = yield* insertUser(sql, "blog-fk-admin");
        const editor = yield* insertUser(sql, "blog-fk-editor");
        const blogId = yield* insertBlog(sql, "blog-fk", admin);
        const mediaId = yield* insertMedia(sql, "blog:blog-fk", editor);
        const postId = yield* insertPost(sql, {
          blogId,
          slug: "post",
          coverMediaId: mediaId,
          authorId: editor,
        });

        yield* sql`DELETE FROM users WHERE id IN (${admin}, ${editor})`;

        const [blog] = yield* sql<{ readonly createdBy: string | null }>`
          SELECT created_by FROM blogs WHERE id = ${blogId}
        `;
        assert.deepStrictEqual(blog, { createdBy: null });
        const [media] = yield* sql<{ readonly uploadedBy: string | null }>`
          SELECT uploaded_by FROM media WHERE id = ${mediaId}
        `;
        assert.deepStrictEqual(media, { uploadedBy: null });
        const [post] = yield* sql<{
          readonly authorId: string | null;
          readonly updatedBy: string | null;
          readonly coverMediaId: string | null;
        }>`
          SELECT author_id, updated_by, cover_media_id
          FROM blog_posts WHERE id = ${postId}
        `;
        assert.deepStrictEqual(post, {
          authorId: null,
          updatedBy: null,
          coverMediaId: mediaId,
        });
      }),
    );

    it.effect("removes a deleted cover image and keeps blogs with posts", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const blogId = yield* insertBlog(sql, "blog-restrict");
        const emptyBlogId = yield* insertBlog(sql, "blog-restrict-empty");
        const mediaId = yield* insertMedia(sql, "blog:blog-restrict");
        const postId = yield* insertPost(sql, {
          blogId,
          slug: "post",
          coverMediaId: mediaId,
        });

        yield* sql`DELETE FROM media WHERE id = ${mediaId}`;
        const [post] = yield* sql<{ readonly coverMediaId: string | null }>`
          SELECT cover_media_id FROM blog_posts WHERE id = ${postId}
        `;
        assert.deepStrictEqual(post, { coverMediaId: null });

        // ON DELETE RESTRICT: a subblog with posts cannot be deleted.
        const error = yield* sql`DELETE FROM blogs WHERE id = ${blogId}`.pipe(
          Effect.flip,
        );
        assert.strictEqual(error.reason._tag, "ConstraintError");
        assert.propertyVal(
          error.reason.cause,
          "constraint",
          "blog_posts_blog_id_fkey",
        );
        yield* sql`DELETE FROM blogs WHERE id = ${emptyBlogId}`;
        yield* sql`DELETE FROM blog_posts WHERE id = ${postId}`;
        yield* sql`DELETE FROM blogs WHERE id = ${blogId}`;
        const rest = yield* sql`
          SELECT id FROM blogs WHERE id IN (${blogId}, ${emptyBlogId})
        `;
        assert.strictEqual(rest.length, 0);
      }),
    );

    it.effect(
      "uses the partial and GIN indexes for the public post lists",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          // The table is tiny, so the planner would prefer a sequential scan.
          const explain = (query: Statement.Fragment) =>
            sql
              .withTransaction(
                Effect.gen(function* () {
                  yield* sql`SET LOCAL enable_seqscan = off`;
                  return yield* sql<Record<string, string>>`EXPLAIN ${query}`;
                }),
              )
              .pipe(
                Effect.map((plan) =>
                  plan.flatMap((row) => Object.values(row)).join("\n"),
                ),
              );
          const blogId = "00000000-0000-4000-8000-000000000b03";
          assert.include(
            yield* explain(sql`
            SELECT id FROM blog_posts
            WHERE blog_id = ${blogId} AND status = 'published'
              AND (published_at, id) < (now(), ${blogId})
            ORDER BY published_at DESC, id DESC LIMIT 10
          `),
            "blog_posts_blog_id_published_at_id_idx",
          );
          assert.include(
            yield* explain(sql`
            SELECT id FROM blog_posts
            WHERE status = 'published'
              AND (published_at, id) < (now(), ${blogId})
            ORDER BY published_at DESC, id DESC LIMIT 10
          `),
            "blog_posts_published_at_id_idx",
          );
          assert.include(
            yield* explain(sql`
            SELECT id FROM blog_posts WHERE tags @> ARRAY['rust']
          `),
            "blog_posts_tags_idx",
          );
          assert.include(
            yield* explain(sql`
            SELECT id FROM blog_posts WHERE blog_id = ${blogId}
            ORDER BY updated_at DESC
          `),
            "blog_posts_blog_id_updated_at_idx",
          );
        }),
    );

    it.effect("creates the projects table with the expected columns", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeColumns(sql, "projects"), [
          "projects.id uuid not null",
          "projects.slug text not null",
          "projects.title text not null",
          "projects.summary text not null",
          "projects.tags ARRAY not null default '{}'::text[]",
          "projects.status text not null",
          "projects.featured boolean not null default false",
          "projects.position integer not null default 0",
          "projects.repo_url text",
          "projects.live_url text",
          "projects.cover_media_id uuid",
          "projects.content jsonb not null",
          "projects.published boolean not null default false",
          "projects.created_by uuid",
          "projects.updated_by uuid",
          "projects.created_at timestamp with time zone not null",
          "projects.updated_at timestamp with time zone not null",
          "projects.version integer not null default 1",
        ]);
      }),
    );

    it.effect("constrains and indexes projects", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeConstraints(sql, "projects"), [
          `projects_content_check: CHECK ((content @> '{"type": "doc"}'::jsonb))`,
          "projects_cover_media_id_fkey: FOREIGN KEY (cover_media_id) REFERENCES media(id) ON DELETE SET NULL",
          "projects_created_by_fkey: FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL",
          "projects_id_pkey: PRIMARY KEY (id)",
          "projects_live_url_check: CHECK (((live_url ~ '^https?://'::text) AND (char_length(live_url) <= 2048)))",
          'projects_position_check: CHECK ((("position" >= 0) AND ("position" <= 10000)))',
          "projects_repo_url_check: CHECK (((repo_url ~ '^https?://'::text) AND (char_length(repo_url) <= 2048)))",
          "projects_slug_check: CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (char_length(slug) <= 64)))",
          "projects_slug_key: UNIQUE (slug)",
          "projects_status_check: CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'archived'::text])))",
          "projects_summary_check: CHECK (((char_length(summary) <= 500) AND (summary !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
          "projects_tags_check: CHECK (((cardinality(tags) <= 10) AND blog_posts_tags_valid(tags)))",
          "projects_title_check: CHECK ((((char_length(title) >= 1) AND (char_length(title) <= 120)) AND (title !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
          "projects_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL",
          "projects_version_check: CHECK ((version >= 1))",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "projects"), [
          'CREATE INDEX projects_featured_position_updated_at_id_idx ON public.projects USING btree (featured DESC, "position", updated_at DESC, id) WHERE published',
          "CREATE UNIQUE INDEX projects_id_pkey ON public.projects USING btree (id)",
          "CREATE UNIQUE INDEX projects_slug_key ON public.projects USING btree (slug)",
        ]);
      }),
    );

    it.effect("accepts valid projects and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* insertProject(sql, { slug: "proj-a" });
        // The limits: 64-character slug, 120 title and 500 summary code
        // points, 10 tags of 32 characters, position 0 and 10000, URLs of
        // 2048 characters.
        const longUrl = `https://example.com/${"a".repeat(2048 - 20)}`;
        assert.strictEqual(longUrl.length, 2048);
        yield* insertProject(sql, {
          slug: `proj-${"a".repeat(59)}`,
          title: "😀".repeat(120),
          summary: "😀 \n😀".repeat(100),
          tags: Array.from({ length: 10 }, (_, i) => `${i}`.repeat(32)),
          status: "completed",
          featured: true,
          position: 10000,
          repoUrl: longUrl,
          liveUrl: "http://localhost:8080/",
          published: true,
          version: 3,
        });
        yield* insertProject(sql, {
          slug: "proj-b",
          status: "archived",
          repoUrl: "https://github.com/x/y",
          liveUrl: null,
        });

        const cases = [
          [{ slug: "" }, "projects_slug_check"],
          [{ slug: "Proj" }, "projects_slug_check"],
          [{ slug: "proj--c" }, "projects_slug_check"],
          [{ slug: "proj_c" }, "projects_slug_check"],
          [{ slug: `proj-${"a".repeat(60)}` }, "projects_slug_check"],
          [{ title: "" }, "projects_title_check"],
          [{ title: "t".repeat(121) }, "projects_title_check"],
          [{ title: " T" }, "projects_title_check"],
          [{ summary: "s".repeat(501) }, "projects_summary_check"],
          [{ summary: "s\n" }, "projects_summary_check"],
          [
            { tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`) },
            "projects_tags_check",
          ],
          [{ tags: ["rust", "rust"] }, "projects_tags_check"],
          [{ tags: ["Rust"] }, "projects_tags_check"],
          [{ tags: ["t".repeat(33)] }, "projects_tags_check"],
          [{ tags: ["rust", null] }, "projects_tags_check"],
          [{ status: "draft" }, "projects_status_check"],
          [{ status: "Active" }, "projects_status_check"],
          [{ position: -1 }, "projects_position_check"],
          [{ position: 10001 }, "projects_position_check"],
          [{ repoUrl: "" }, "projects_repo_url_check"],
          [{ repoUrl: "ftp://example.com" }, "projects_repo_url_check"],
          [{ repoUrl: "javascript:alert(1)" }, "projects_repo_url_check"],
          [{ repoUrl: "//example.com" }, "projects_repo_url_check"],
          [{ repoUrl: " https://example.com" }, "projects_repo_url_check"],
          [{ repoUrl: `${longUrl}a` }, "projects_repo_url_check"],
          [{ liveUrl: "example.com" }, "projects_live_url_check"],
          [{ liveUrl: "data:text/html,x" }, "projects_live_url_check"],
          [{ liveUrl: `${longUrl}a` }, "projects_live_url_check"],
          [{ content: [] }, "projects_content_check"],
          [{ content: "doc" }, "projects_content_check"],
          [{ content: { type: "paragraph" } }, "projects_content_check"],
          [{ version: 0 }, "projects_version_check"],
        ] as const;
        for (const [project, constraint] of cases) {
          const error = yield* insertProject(sql, {
            slug: "proj-invalid",
            ...project,
          }).pipe(
            Effect.tap(() =>
              Effect.sync(() => assert.fail(`accepted: ${constraint}`)),
            ),
            Effect.flip,
          );
          assert.strictEqual(error.reason._tag, "ConstraintError", constraint);
          assert.propertyVal(error.reason.cause, "constraint", constraint);
        }

        const duplicate = yield* insertProject(sql, { slug: "proj-a" }).pipe(
          Effect.flip,
        );
        assert.strictEqual(duplicate.reason._tag, "UniqueViolation");
        if (duplicate.reason._tag === "UniqueViolation") {
          assert.strictEqual(duplicate.reason.constraint, "projects_slug_key");
        }

        const unknownCover = yield* insertProject(sql, {
          slug: "proj-c",
          coverMediaId: "00000000-0000-4000-8000-000000000c01",
        }).pipe(Effect.flip);
        assert.propertyVal(
          unknownCover.reason.cause,
          "constraint",
          "projects_cover_media_id_fkey",
        );
        const unknownUser = yield* insertProject(sql, {
          slug: "proj-c",
          createdBy: "00000000-0000-4000-8000-000000000c02",
        }).pipe(Effect.flip);
        assert.propertyVal(
          unknownUser.reason.cause,
          "constraint",
          "projects_created_by_fkey",
        );
      }),
    );

    it.effect("keeps projects when their users and cover are deleted", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const admin = yield* insertUser(sql, "project-fk-admin");
        const mediaId = yield* insertMedia(sql, "projects", admin);
        const projectId = yield* insertProject(sql, {
          slug: "proj-fk",
          coverMediaId: mediaId,
          createdBy: admin,
        });

        yield* sql`DELETE FROM users WHERE id = ${admin}`;
        const [afterUser] = yield* sql<{
          readonly createdBy: string | null;
          readonly updatedBy: string | null;
          readonly coverMediaId: string | null;
        }>`
          SELECT created_by, updated_by, cover_media_id
          FROM projects WHERE id = ${projectId}
        `;
        assert.deepStrictEqual(afterUser, {
          createdBy: null,
          updatedBy: null,
          coverMediaId: mediaId,
        });

        yield* sql`DELETE FROM media WHERE id = ${mediaId}`;
        const [afterMedia] = yield* sql<{
          readonly coverMediaId: string | null;
        }>`
          SELECT cover_media_id FROM projects WHERE id = ${projectId}
        `;
        assert.deepStrictEqual(afterMedia, { coverMediaId: null });
      }),
    );

    it.effect("lists published projects with the listing index", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const listing = sql`
          SELECT slug FROM projects
          WHERE published AND slug LIKE 'list-%'
          ORDER BY featured DESC, position, updated_at DESC, id
        `;
        yield* insertProject(sql, {
          slug: "list-draft",
          featured: true,
          published: false,
        });
        yield* insertProject(sql, {
          slug: "list-plain-old",
          position: 1,
          published: true,
          updatedAt: "2026-01-01T00:00:00Z",
        });
        yield* insertProject(sql, {
          slug: "list-plain-new",
          position: 1,
          published: true,
          updatedAt: "2026-02-01T00:00:00Z",
        });
        yield* insertProject(sql, {
          slug: "list-plain-first",
          position: 0,
          published: true,
        });
        yield* insertProject(sql, {
          slug: "list-featured",
          featured: true,
          position: 50,
          published: true,
        });
        const rows = yield* sql<{ readonly slug: string }>`${listing}`;
        assert.deepStrictEqual(
          rows.map((row) => row.slug),
          [
            "list-featured",
            "list-plain-first",
            "list-plain-new",
            "list-plain-old",
          ],
        );

        // The table is tiny and has no statistics, so the planner would
        // prefer a sequential scan, or a bitmap scan and a sort.
        const plan = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET LOCAL enable_seqscan = off`;
            yield* sql`SET LOCAL enable_bitmapscan = off`;
            return yield* sql<Record<string, string>>`
              EXPLAIN
              SELECT id FROM projects
              WHERE published
              ORDER BY featured DESC, position, updated_at DESC, id
            `;
          }),
        );
        const text = plan.flatMap((row) => Object.values(row)).join("\n");
        assert.include(text, "projects_featured_position_updated_at_id_idx");
        // The index delivers the order; no sort step.
        assert.notInclude(text, "Sort");
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

describe("0012_allow_blog_editor_roles", () => {
  // Runs the migrations before 0012 first, so roles and their log exist
  // before the checks are replaced.
  const DatabaseBefore0012 = databaseUpTo(11);

  it.effect(
    "keeps the existing roles and validates the replaced checks",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const alice = yield* insertUser(sql, "blog-editor-alice");
        yield* sql`
          INSERT INTO user_roles (user_id, role) VALUES
            (${alice}, 'normalUser'),
            (${alice}, 'superAdmin')
        `;
        yield* sql`
          INSERT INTO user_role_changes (user_id, role, change, changed_at)
          VALUES (${alice}, 'superAdmin', 'granted', now())
        `;
        // Not allowed before 0012.
        const before = yield* sql`
          INSERT INTO user_roles (user_id, role)
          VALUES (${alice}, 'blogEditor:rust-notes')
        `.pipe(Effect.flip);
        assert.strictEqual(before.reason._tag, "ConstraintError");

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(12) });
        assert.deepStrictEqual(applied, [[12, "allow_blog_editor_roles"]]);

        const roles = yield* sql<{ readonly role: string }>`
          SELECT role FROM user_roles WHERE user_id = ${alice} ORDER BY role
        `;
        assert.deepStrictEqual(
          roles.map((row) => row.role),
          ["normalUser", "superAdmin"],
        );

        // Same names, and validated (not NOT VALID) on both tables.
        const checks = yield* sql<{
          readonly conname: string;
          readonly convalidated: boolean;
        }>`
          SELECT conname, convalidated FROM pg_constraint
          WHERE conname IN (
            'user_roles_role_check', 'user_role_changes_role_check'
          )
          ORDER BY conname
        `;
        assert.deepStrictEqual(checks, [
          { conname: "user_role_changes_role_check", convalidated: true },
          { conname: "user_roles_role_check", convalidated: true },
        ]);

        yield* sql`
          INSERT INTO user_roles (user_id, role)
          VALUES (${alice}, 'blogEditor:rust-notes')
        `;
      }).pipe(Effect.provide(DatabaseBefore0012)),
    { timeout: 30_000 },
  );
});

const insertUser = (sql: SqlClient.SqlClient, subject: string) =>
  sql<{ readonly id: string }>`
    INSERT INTO users (id, subject, created_at, updated_at, last_login_at)
    VALUES (gen_random_uuid(), ${subject}, now(), now(), now())
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));

/** Inserts a subblog and returns its id. */
const insertBlog = (
  sql: SqlClient.SqlClient,
  slug: string,
  createdBy: string | null = null,
) =>
  sql<{ readonly id: string }>`
    INSERT INTO blogs
      (id, slug, title, description, created_at, created_by, updated_at)
    VALUES (gen_random_uuid(), ${slug}, 'Title', '', now(), ${createdBy}, now())
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));

/** Inserts a 4-byte PNG "image" with a matching size and digest. */
const insertMedia = (
  sql: SqlClient.SqlClient,
  scope: string,
  uploadedBy: string | null = null,
) =>
  sql<{ readonly id: string }>`
    INSERT INTO media
      (id, content_type, data, byte_size, sha256, scope, uploaded_by, uploaded_at)
    SELECT gen_random_uuid(), 'image/png', d, octet_length(d), sha256(d),
      ${scope}, ${uploadedBy}, now()
    FROM (SELECT '\\x89504e47'::bytea AS d) AS upload
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));

/** Inserts a post, a draft with an empty document by default. */
const insertPost = (
  sql: SqlClient.SqlClient,
  post: {
    readonly blogId: string;
    readonly slug: string;
    readonly title?: string;
    readonly summary?: string;
    readonly tags?: ReadonlyArray<string | null>;
    readonly coverMediaId?: string;
    readonly content?: unknown;
    readonly status?: string;
    readonly publishedAt?: string;
    readonly authorId?: string;
    readonly version?: number;
  },
) =>
  sql<{ readonly id: string }>`
    INSERT INTO blog_posts (
      id, blog_id, slug, title, summary, tags, cover_media_id, content,
      status, published_at, author_id, updated_by, created_at, updated_at,
      version
    )
    VALUES (
      gen_random_uuid(), ${post.blogId}, ${post.slug}, ${post.title ?? "Title"},
      ${post.summary ?? ""}, ${post.tags ?? []}::text[],
      ${post.coverMediaId ?? null},
      ${JSON.stringify(post.content ?? { type: "doc", content: [{ type: "paragraph" }] })}::jsonb,
      ${post.status ?? "draft"}, ${post.publishedAt ?? null}::timestamptz,
      ${post.authorId ?? null}, ${post.authorId ?? null},
      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ${post.version ?? 1}
    )
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));

/** Inserts a project, an unpublished one with an empty document by default. */
const insertProject = (
  sql: SqlClient.SqlClient,
  project: {
    readonly slug: string;
    readonly title?: string;
    readonly summary?: string;
    readonly tags?: ReadonlyArray<string | null>;
    readonly status?: string;
    readonly featured?: boolean;
    readonly position?: number;
    readonly repoUrl?: string | null;
    readonly liveUrl?: string | null;
    readonly coverMediaId?: string;
    readonly content?: unknown;
    readonly published?: boolean;
    readonly createdBy?: string;
    readonly updatedAt?: string;
    readonly version?: number;
  },
) =>
  sql<{ readonly id: string }>`
    INSERT INTO projects (
      id, slug, title, summary, tags, status, featured, position, repo_url,
      live_url, cover_media_id, content, published, created_by, updated_by,
      created_at, updated_at, version
    )
    VALUES (
      gen_random_uuid(), ${project.slug}, ${project.title ?? "Title"},
      ${project.summary ?? ""}, ${project.tags ?? []}::text[],
      ${project.status ?? "active"}, ${project.featured ?? false},
      ${project.position ?? 0}, ${project.repoUrl ?? null},
      ${project.liveUrl ?? null}, ${project.coverMediaId ?? null},
      ${JSON.stringify(project.content ?? { type: "doc", content: [{ type: "paragraph" }] })}::jsonb,
      ${project.published ?? false}, ${project.createdBy ?? null},
      ${project.createdBy ?? null}, '2026-01-01T00:00:00Z',
      ${project.updatedAt ?? "2026-01-01T00:00:00Z"}::timestamptz,
      ${project.version ?? 1}
    )
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));
