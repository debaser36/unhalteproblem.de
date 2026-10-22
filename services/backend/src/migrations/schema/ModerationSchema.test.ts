import { assert, describe, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { DatabaseTest } from "#testing/Database";
import { insertUser } from "./Helpers.ts";

describe("DatabaseTest", () => {
  layer(DatabaseTest, { timeout: "30 seconds" })((it) => {
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
  });
});
