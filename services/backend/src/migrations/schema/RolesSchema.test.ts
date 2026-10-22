import { assert, describe, layer } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { SqlClient } from "effect/sql";
import {
  describeColumns,
  describeConstraints,
  describeIndexes,
  fixedRoles,
  roleCheck,
  validBlogEditorRoles,
  invalidBlogEditorRoles,
  insertUser,
} from "./Helpers.ts";

import { DatabaseTest } from "#testing/Database";

describe("DatabaseTest", () => {
  layer(DatabaseTest, { timeout: "30 seconds" })((it) => {
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
            // Replaced by 0012 and 0019.
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
              // Replaced by 0012 and 0019, like user_roles_role_check.
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
  });
});
