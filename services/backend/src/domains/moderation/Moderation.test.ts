import { assert, describe, it, layer } from "@effect/vitest";
import {
  AlreadyRestricted,
  Forbidden,
  NotRestricted,
  RestrictionNotAllowed,
  type Role,
  RoleChangeNotAllowed,
} from "@unhalteproblem.de/api";
import { DateTime, Effect, Exit, Option } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { hashSecret } from "#auth/Secrets";
import { Sessions } from "#repositories/Sessions";
import {
  asAdmin,
  asSuperAdmin,
  type Member,
  member,
  published,
  UsersTest,
} from "#testing/Users";
import {
  restrictionRefusal,
  revocationRefusal,
  RestrictionLifted,
  RoleGranted,
  RoleRevoked,
  UserRestricted,
} from "./Moderation.ts";
import { UserId, UserNotFound } from "#domains/users/User";
import { UserQueries } from "#domains/users/UserQueries";
import { UserCommands } from "#domains/users/UserCommands";
import { ModerationCommands } from "./ModerationCommands.ts";
import { ModerationQueries } from "./ModerationQueries.ts";

const a = UserId.make("8f3c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b");
const b = UserId.make("1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d");

/** An id no user has. */
const unknownId = UserId.make("00000000-0000-4000-8000-000000000000");

describe("restrictionRefusal", () => {
  const party = (id: UserId, ...roles: ReadonlyArray<Role>) => ({ id, roles });

  it.for<ReadonlyArray<Role>>([
    ["normalUser", "admin"],
    ["normalUser", "admin", "superAdmin"],
  ])("refuses acting on yourself, whatever the roles (%j)", (roles) => {
    assert.deepStrictEqual(
      restrictionRefusal(party(a, ...roles), party(a, ...roles)),
      Option.some("self"),
    );
  });

  it.for<ReadonlyArray<Role>>([
    ["admin"],
    ["superAdmin"],
    ["normalUser", "admin", "superAdmin"],
  ])("refuses an admin acting on a target with %j", (roles) => {
    assert.deepStrictEqual(
      restrictionRefusal(party(a, "normalUser", "admin"), party(b, ...roles)),
      Option.some("privilegedTarget"),
    );
  });

  it.for<ReadonlyArray<Role>>([["normalUser"], []])(
    "lets an admin act on a target with %j",
    (roles) => {
      assert.deepStrictEqual(
        restrictionRefusal(party(a, "normalUser", "admin"), party(b, ...roles)),
        Option.none(),
      );
    },
  );

  it.for<ReadonlyArray<Role>>([
    ["normalUser"],
    ["admin"],
    ["superAdmin"],
    ["normalUser", "admin", "superAdmin"],
  ])("lets a superAdmin act on a target with %j", (roles) => {
    assert.deepStrictEqual(
      restrictionRefusal(
        party(a, "normalUser", "admin", "superAdmin"),
        party(b, ...roles),
      ),
      Option.none(),
    );
  });
});

describe("revocationRefusal", () => {
  it.each([1, 2, 5])(
    "refuses revoking your own superAdmin (%i superAdmins)",
    (superAdmins) => {
      assert.deepStrictEqual(
        revocationRefusal({
          actor: a,
          target: a,
          role: "superAdmin",
          superAdmins,
        }),
        Option.some("ownSuperAdmin"),
      );
    },
  );

  it.each([0, 1])(
    "refuses revoking the last superAdmin (%i superAdmins)",
    (superAdmins) => {
      assert.deepStrictEqual(
        revocationRefusal({
          actor: a,
          target: b,
          role: "superAdmin",
          superAdmins,
        }),
        Option.some("lastSuperAdmin"),
      );
    },
  );

  it.each([2, 3])(
    "allows revoking another superAdmin's superAdmin (%i superAdmins)",
    (superAdmins) => {
      assert.deepStrictEqual(
        revocationRefusal({
          actor: a,
          target: b,
          role: "superAdmin",
          superAdmins,
        }),
        Option.none(),
      );
    },
  );

  it.for<readonly [Role, UserId, number]>([
    ["admin", a, 0],
    ["admin", b, 1],
    ["normalUser", a, 1],
    ["normalUser", b, 0],
  ])("never refuses %s (target %s, %i superAdmins)", ([role, target, n]) => {
    assert.deepStrictEqual(
      revocationRefusal({ actor: a, target, role, superAdmins: n }),
      Option.none(),
    );
  });
});

// Commands and queries

interface RoleChangeRow {
  readonly role: string;
  readonly change: string;
  readonly changedBy: string | null;
  readonly changedAt: Date;
}

/** The user's role change log, as stored. */
const roleChangeRows = (user: Member) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<RoleChangeRow>`
      SELECT role, change, changed_by, changed_at FROM user_role_changes
      WHERE user_id = ${user.user.id}
      ORDER BY id
    `,
  ).pipe(Effect.orDie);

/** The user's role grants, as stored. */
const roleRows = (user: Member) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{
      readonly role: string;
      readonly grantedBy: string | null;
      readonly grantedAt: Date;
    }>`
      SELECT role, granted_by, granted_at FROM user_roles
      WHERE user_id = ${user.user.id}
      ORDER BY role
    `,
  ).pipe(Effect.orDie);

/** How many sessions the user has, as stored. */
const sessionCount = (user: Member) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ readonly count: number }>`
      SELECT count(*)::int AS count FROM auth_sessions
      WHERE user_id = ${user.subject}
    `,
  ).pipe(
    Effect.map((rows) => rows[0]?.count ?? 0),
    Effect.orDie,
  );

/** Stores a session of the user, as a login would. */
const addSession = (user: Member) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    const now = yield* DateTime.now;
    yield* sessions
      .create({
        idHash: hashSecret(crypto.randomUUID()),
        userId: user.subject,
        providerSessionId: Option.some(crypto.randomUUID()),
        claims: {},
        expiresAt: DateTime.add(now, { days: 1 }),
      })
      .pipe(Effect.orDie);
  });

const millis = (time: DateTime.Utc) => DateTime.toEpochMillis(time);

const rolesOf = (user: Member) =>
  Effect.flatMap(ModerationQueries, (queries) =>
    queries.accessOf(user.subject),
  ).pipe(Effect.map(({ roles }) => roles));

const isRestricted = (user: Member) =>
  Effect.flatMap(ModerationQueries, (queries) =>
    queries.accessOf(user.subject),
  ).pipe(Effect.map(({ restricted }) => restricted));

describe("ModerationCommands", () => {
  layer(UsersTest, { timeout: "30 seconds" })((it) => {
    describe("role change log", () => {
      it.effect(
        "logs normalUser at registration as granted by the system",
        () =>
          Effect.gen(function* () {
            const user = yield* member();
            const at = millis(user.user.createdAt);
            assert.deepStrictEqual(yield* roleChangeRows(user), [
              {
                role: "normalUser",
                change: "granted",
                changedBy: null,
                changedAt: new Date(at),
              },
            ]);
            assert.deepStrictEqual(yield* roleRows(user), [
              { role: "normalUser", grantedBy: null, grantedAt: new Date(at) },
            ]);
          }),
      );
    });

    describe("grantRole", () => {
      it.effect.each<Role>(["admin", "superAdmin"])(
        "grants %s and logs who granted it and when",
        (role) =>
          Effect.gen(function* () {
            const commands = yield* ModerationCommands;
            const root = yield* member("admin", "superAdmin");
            const target = yield* member();
            yield* TestClock.adjust("1 hour");
            const now = yield* DateTime.now;
            const { take } = yield* published;

            yield* commands
              .grantRole(target.user.id, role)
              .pipe(asSuperAdmin(root));

            assert.deepStrictEqual(
              yield* rolesOf(target),
              Array.of<Role>(role, "normalUser").sort(),
            );
            const grant = (yield* roleRows(target)).find(
              (row) => row.role === role,
            );
            assert.deepStrictEqual(grant, {
              role,
              grantedBy: root.user.id,
              grantedAt: new Date(millis(now)),
            });
            // Actors are logged by our id, not by their subject.
            assert.deepStrictEqual((yield* roleChangeRows(target)).at(-1), {
              role,
              change: "granted",
              changedBy: root.user.id,
              changedAt: new Date(millis(now)),
            });
            assert.deepStrictEqual(yield* take, [
              new RoleGranted({
                userId: target.user.id,
                role,
                by: root.user.id,
              }),
            ]);
          }),
      );

      it.effect("lets a superAdmin grant a role to themselves", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const root = yield* member("superAdmin");
          yield* commands
            .grantRole(root.user.id, "admin")
            .pipe(asSuperAdmin(root));
          assert.deepStrictEqual(yield* rolesOf(root), [
            "admin",
            "normalUser",
            "superAdmin",
          ]);
        }),
      );

      it.effect("changes nothing when the user already holds the role", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const root = yield* member("admin", "superAdmin");
          const other = yield* member("superAdmin");
          const target = yield* member();
          yield* commands
            .grantRole(target.user.id, "admin")
            .pipe(asSuperAdmin(root));
          const roles = yield* roleRows(target);
          const log = yield* roleChangeRows(target);
          yield* TestClock.adjust("1 hour");
          const { take } = yield* published;

          yield* commands
            .grantRole(target.user.id, "admin")
            .pipe(asSuperAdmin(other));
          yield* commands
            .grantRole(target.user.id, "normalUser")
            .pipe(asSuperAdmin(other));

          // The first grant's granter and time stay.
          assert.deepStrictEqual(yield* roleRows(target), roles);
          assert.deepStrictEqual(yield* roleChangeRows(target), log);
          assert.deepStrictEqual(yield* take, []);
        }),
      );

      it.effect("fails with UserNotFound for an unknown id", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const root = yield* member("superAdmin");
          const error = yield* commands
            .grantRole(unknownId, "admin")
            .pipe(asSuperAdmin(root), Effect.flip);
          assert.deepStrictEqual(
            error,
            new UserNotFound({ userId: unknownId }),
          );
        }),
      );
    });

    describe("revokeRole", () => {
      it.effect("revokes a role and logs who revoked it and when", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const root = yield* member("superAdmin");
          const target = yield* member("admin");
          yield* TestClock.adjust("1 hour");
          const now = yield* DateTime.now;
          const { take } = yield* published;

          yield* commands
            .revokeRole(target.user.id, "admin")
            .pipe(asSuperAdmin(root));

          assert.deepStrictEqual(yield* rolesOf(target), ["normalUser"]);
          assert.deepStrictEqual((yield* roleChangeRows(target)).at(-1), {
            role: "admin",
            change: "revoked",
            changedBy: root.user.id,
            changedAt: new Date(millis(now)),
          });
          assert.deepStrictEqual(yield* take, [
            new RoleRevoked({
              userId: target.user.id,
              role: "admin",
              by: root.user.id,
            }),
          ]);
        }),
      );

      it.effect("changes nothing when the user doesn't hold the role", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const root = yield* member("superAdmin");
          const target = yield* member();
          const log = yield* roleChangeRows(target);
          const { take } = yield* published;

          yield* commands
            .revokeRole(target.user.id, "admin")
            .pipe(asSuperAdmin(root));
          yield* commands
            .revokeRole(target.user.id, "superAdmin")
            .pipe(asSuperAdmin(root));

          assert.deepStrictEqual(yield* rolesOf(target), ["normalUser"]);
          assert.deepStrictEqual(yield* roleChangeRows(target), log);
          assert.deepStrictEqual(yield* take, []);
        }),
      );

      it.effect("revokes superAdmin from another superAdmin", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const root = yield* member("superAdmin");
          const other = yield* member("superAdmin");
          yield* commands
            .revokeRole(other.user.id, "superAdmin")
            .pipe(asSuperAdmin(root));
          assert.deepStrictEqual(yield* rolesOf(other), ["normalUser"]);
        }),
      );

      it.effect("refuses to revoke your own superAdmin (ownSuperAdmin)", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const root = yield* member("superAdmin");
          yield* member("superAdmin");
          const log = yield* roleChangeRows(root);
          const { take } = yield* published;

          const error = yield* commands
            .revokeRole(root.user.id, "superAdmin")
            .pipe(asSuperAdmin(root), Effect.flip);

          assert.deepStrictEqual(
            error,
            new RoleChangeNotAllowed({ reason: "ownSuperAdmin" }),
          );
          assert.deepStrictEqual(yield* rolesOf(root), [
            "normalUser",
            "superAdmin",
          ]);
          assert.deepStrictEqual(yield* roleChangeRows(root), log);
          assert.deepStrictEqual(yield* take, []);
        }),
      );

      it.effect("lets a superAdmin revoke their own other roles", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const root = yield* member("admin", "superAdmin");
          yield* commands
            .revokeRole(root.user.id, "admin")
            .pipe(asSuperAdmin(root));
          assert.deepStrictEqual(yield* rolesOf(root), [
            "normalUser",
            "superAdmin",
          ]);
        }),
      );

      it.effect("fails with UserNotFound for an unknown id", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const root = yield* member("superAdmin");
          const error = yield* commands
            .revokeRole(unknownId, "admin")
            .pipe(asSuperAdmin(root), Effect.flip);
          assert.deepStrictEqual(
            error,
            new UserNotFound({ userId: unknownId }),
          );
        }),
      );
    });

    describe("the actor", () => {
      it.effect(
        "is refused with Forbidden without superAdmin in the database",
        () =>
          Effect.gen(function* () {
            const commands = yield* ModerationCommands;
            // The proof says superAdmin (say, read just before a
            // revocation), the database no longer does.
            const stale = {
              ...(yield* member("admin")),
              roles: ["admin", "normalUser", "superAdmin"],
            } satisfies Member;
            const target = yield* member("admin");
            const log = yield* roleChangeRows(target);

            const grant = yield* commands
              .grantRole(target.user.id, "superAdmin")
              .pipe(asSuperAdmin(stale), Effect.flip);
            const revoke = yield* commands
              .revokeRole(target.user.id, "admin")
              .pipe(asSuperAdmin(stale), Effect.flip);

            assert.instanceOf(grant, Forbidden);
            assert.instanceOf(revoke, Forbidden);
            assert.deepStrictEqual(yield* rolesOf(target), [
              "admin",
              "normalUser",
            ]);
            assert.deepStrictEqual(yield* roleChangeRows(target), log);
          }),
      );

      it.effect("is refused with Forbidden without admin in the database", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const stale = {
            ...(yield* member()),
            roles: ["admin", "normalUser"],
          } satisfies Member;
          const target = yield* member();

          const restrict = yield* commands
            .restrict(target.user.id, "spam")
            .pipe(asAdmin(stale), Effect.flip);
          assert.instanceOf(restrict, Forbidden);
          assert.isFalse(yield* isRestricted(target));

          const root = yield* member("admin", "superAdmin");
          yield* commands.restrict(target.user.id, "spam").pipe(asAdmin(root));
          const lift = yield* commands
            .liftRestriction(target.user.id, Option.none())
            .pipe(asAdmin(stale), Effect.flip);
          assert.instanceOf(lift, Forbidden);
          assert.isTrue(yield* isRestricted(target));
        }),
      );

      it.effect("is refused with Forbidden while restricted", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const root = yield* member("admin", "superAdmin");
          const admin = yield* member("admin", "superAdmin");
          const target = yield* member();
          yield* commands.restrict(admin.user.id, "rogue").pipe(asAdmin(root));

          const errors = [
            yield* commands
              .restrict(target.user.id, "spam")
              .pipe(asAdmin(admin), Effect.flip),
            yield* commands
              .grantRole(target.user.id, "admin")
              .pipe(asSuperAdmin(admin), Effect.flip),
            yield* commands
              .revokeRole(root.user.id, "admin")
              .pipe(asSuperAdmin(admin), Effect.flip),
          ];
          for (const error of errors) assert.instanceOf(error, Forbidden);
          assert.isFalse(yield* isRestricted(target));
          assert.deepStrictEqual(yield* rolesOf(target), ["normalUser"]);
          assert.deepStrictEqual(yield* rolesOf(root), [
            "admin",
            "normalUser",
            "superAdmin",
          ]);
        }),
      );

      it.effect(
        "two superAdmins restricting each other: the second is refused",
        () =>
          Effect.gen(function* () {
            const commands = yield* ModerationCommands;
            const first = yield* member("admin", "superAdmin");
            const second = yield* member("admin", "superAdmin");

            yield* commands
              .restrict(second.user.id, "first")
              .pipe(asAdmin(first));
            const error = yield* commands
              .restrict(first.user.id, "second")
              .pipe(asAdmin(second), Effect.flip);

            assert.instanceOf(error, Forbidden);
            assert.isTrue(yield* isRestricted(second));
            assert.isFalse(yield* isRestricted(first));
          }),
      );
    });

    describe("restrict", () => {
      it.effect("restricts with a note and ends the user's sessions", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const queries = yield* UserQueries;
          const admin = yield* member("admin");
          const target = yield* member();
          const bystander = yield* member();
          yield* addSession(target);
          yield* addSession(target);
          yield* addSession(bystander);
          yield* TestClock.adjust("1 hour");
          const now = yield* DateTime.now;
          const { take } = yield* published;

          const restriction = yield* commands
            .restrict(target.user.id, "Spam in the comments")
            .pipe(asAdmin(admin));

          assert.strictEqual(restriction.userId, target.user.id);
          assert.strictEqual(restriction.note, "Spam in the comments");
          assert.deepStrictEqual(
            restriction.restrictedBy,
            Option.some(admin.user.id),
          );
          assert.strictEqual(millis(restriction.restrictedAt), millis(now));
          assert.isTrue(Option.isNone(restriction.liftedAt));
          assert.isTrue(Option.isNone(restriction.liftedBy));
          assert.isTrue(Option.isNone(restriction.liftNote));

          assert.isTrue(yield* isRestricted(target));
          assert.strictEqual(yield* sessionCount(target), 0);
          assert.strictEqual(yield* sessionCount(bystander), 1);
          const details = yield* queries
            .getDetails(target.user.id)
            .pipe(asAdmin(admin));
          assert.deepStrictEqual(
            Option.map(details.restriction, ({ id }) => id),
            Option.some(restriction.id),
          );
          assert.deepStrictEqual(yield* take, [
            new UserRestricted({
              userId: target.user.id,
              restrictionId: restriction.id,
              by: admin.user.id,
            }),
          ]);
        }),
      );

      it.effect("fails with AlreadyRestricted on an active restriction", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const queries = yield* UserQueries;
          const admin = yield* member("admin");
          const target = yield* member();
          yield* commands
            .restrict(target.user.id, "first")
            .pipe(asAdmin(admin));
          yield* addSession(target);
          const { take } = yield* published;

          const error = yield* commands
            .restrict(target.user.id, "second")
            .pipe(asAdmin(admin), Effect.flip);

          assert.deepStrictEqual(
            error,
            new AlreadyRestricted({ userId: target.user.id }),
          );
          const details = yield* queries
            .getDetails(target.user.id)
            .pipe(asAdmin(admin));
          assert.deepStrictEqual(
            details.restrictions.map(({ note }) => note),
            ["first"],
          );
          // Refused before anything happened.
          assert.strictEqual(yield* sessionCount(target), 1);
          assert.deepStrictEqual(yield* take, []);
        }),
      );

      it.effect.each<ReadonlyArray<Role>>([["admin"], ["admin", "superAdmin"]])(
        "refuses restricting yourself (self, actor with %j)",
        (roles) =>
          Effect.gen(function* () {
            const commands = yield* ModerationCommands;
            const actor = yield* member(...roles);
            const error = yield* commands
              .restrict(actor.user.id, "me")
              .pipe(asAdmin(actor), Effect.flip);
            assert.deepStrictEqual(
              error,
              new RestrictionNotAllowed({ reason: "self" }),
            );
            assert.isFalse(yield* isRestricted(actor));
          }),
      );

      it.effect.each<ReadonlyArray<Role>>([
        ["admin"],
        ["superAdmin"],
        ["admin", "superAdmin"],
      ])(
        "refuses an admin restricting a user with %j (privilegedTarget)",
        (roles) =>
          Effect.gen(function* () {
            const commands = yield* ModerationCommands;
            const admin = yield* member("admin");
            const target = yield* member(...roles);
            yield* addSession(target);
            const error = yield* commands
              .restrict(target.user.id, "no")
              .pipe(asAdmin(admin), Effect.flip);
            assert.deepStrictEqual(
              error,
              new RestrictionNotAllowed({ reason: "privilegedTarget" }),
            );
            assert.isFalse(yield* isRestricted(target));
            assert.strictEqual(yield* sessionCount(target), 1);
          }),
      );

      it.effect.each<ReadonlyArray<Role>>([
        ["admin"],
        ["superAdmin"],
        ["admin", "superAdmin"],
      ])("lets an admin and superAdmin restrict a user with %j", (roles) =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const root = yield* member("admin", "superAdmin");
          const target = yield* member(...roles);
          yield* commands.restrict(target.user.id, "yes").pipe(asAdmin(root));
          assert.isTrue(yield* isRestricted(target));
        }),
      );

      it.effect("fails with UserNotFound for an unknown id", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const admin = yield* member("admin");
          const error = yield* commands
            .restrict(unknownId, "who?")
            .pipe(asAdmin(admin), Effect.flip);
          assert.deepStrictEqual(
            error,
            new UserNotFound({ userId: unknownId }),
          );
        }),
      );
    });

    describe("liftRestriction", () => {
      it.effect("lifts the restriction, ends sessions and keeps history", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const queries = yield* UserQueries;
          const admin = yield* member("admin");
          const other = yield* member("admin");
          const target = yield* member();
          const first = yield* commands
            .restrict(target.user.id, "first")
            .pipe(asAdmin(admin));
          // A session that survived the restriction (see Authentication).
          yield* addSession(target);
          yield* TestClock.adjust("1 hour");
          const liftedAt = yield* DateTime.now;
          const { take } = yield* published;

          const lifted = yield* commands
            .liftRestriction(target.user.id, Option.some("appealed"))
            .pipe(asAdmin(other));

          assert.strictEqual(lifted.id, first.id);
          assert.strictEqual(lifted.note, "first");
          assert.deepStrictEqual(
            lifted.restrictedBy,
            Option.some(admin.user.id),
          );
          assert.deepStrictEqual(
            Option.map(lifted.liftedAt, millis),
            Option.some(millis(liftedAt)),
          );
          assert.deepStrictEqual(lifted.liftedBy, Option.some(other.user.id));
          assert.deepStrictEqual(lifted.liftNote, Option.some("appealed"));
          assert.isFalse(yield* isRestricted(target));
          assert.strictEqual(yield* sessionCount(target), 0);
          assert.deepStrictEqual(yield* take, [
            new RestrictionLifted({
              userId: target.user.id,
              restrictionId: first.id,
              by: other.user.id,
            }),
          ]);

          yield* TestClock.adjust("1 hour");
          const second = yield* commands
            .restrict(target.user.id, "second")
            .pipe(asAdmin(admin));
          const details = yield* queries
            .getDetails(target.user.id)
            .pipe(asAdmin(admin));
          // Newest first; the lift is stored as returned.
          assert.deepStrictEqual(
            details.restrictions.map(({ id }) => id),
            [second.id, first.id],
          );
          const stored = details.restrictions[1];
          assert.deepStrictEqual(stored?.liftNote, Option.some("appealed"));
          assert.deepStrictEqual(stored?.liftedBy, Option.some(other.user.id));
          assert.deepStrictEqual(
            Option.map(details.restriction, ({ id }) => id),
            Option.some(second.id),
          );
        }),
      );

      it.effect("stores a lift without a note as none", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const queries = yield* UserQueries;
          const admin = yield* member("admin");
          const target = yield* member();
          yield* commands.restrict(target.user.id, "x").pipe(asAdmin(admin));
          const lifted = yield* commands
            .liftRestriction(target.user.id, Option.none())
            .pipe(asAdmin(admin));
          assert.isTrue(Option.isNone(lifted.liftNote));
          const details = yield* queries
            .getDetails(target.user.id)
            .pipe(asAdmin(admin));
          assert.isTrue(Option.isNone(details.restriction));
          assert.isTrue(
            Option.isNone(
              details.restrictions[0]?.liftNote ?? Option.some("missing"),
            ),
          );
        }),
      );

      it.effect("fails with NotRestricted without an active restriction", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const admin = yield* member("admin");
          const target = yield* member();
          const never = yield* commands
            .liftRestriction(target.user.id, Option.none())
            .pipe(asAdmin(admin), Effect.flip);
          assert.deepStrictEqual(
            never,
            new NotRestricted({ userId: target.user.id }),
          );

          yield* commands.restrict(target.user.id, "x").pipe(asAdmin(admin));
          yield* commands
            .liftRestriction(target.user.id, Option.none())
            .pipe(asAdmin(admin));
          const again = yield* commands
            .liftRestriction(target.user.id, Option.some("again"))
            .pipe(asAdmin(admin), Effect.flip);
          assert.deepStrictEqual(
            again,
            new NotRestricted({ userId: target.user.id }),
          );
        }),
      );

      it.effect("refuses lifting your own restriction (self)", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const admin = yield* member("admin");
          const error = yield* commands
            .liftRestriction(admin.user.id, Option.none())
            .pipe(asAdmin(admin), Effect.flip);
          assert.deepStrictEqual(
            error,
            new RestrictionNotAllowed({ reason: "self" }),
          );
        }),
      );

      it.effect("refuses an admin lifting an admin's restriction", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const root = yield* member("admin", "superAdmin");
          const admin = yield* member("admin");
          const target = yield* member("admin");
          yield* commands.restrict(target.user.id, "x").pipe(asAdmin(root));

          const error = yield* commands
            .liftRestriction(target.user.id, Option.none())
            .pipe(asAdmin(admin), Effect.flip);

          assert.deepStrictEqual(
            error,
            new RestrictionNotAllowed({ reason: "privilegedTarget" }),
          );
          assert.isTrue(yield* isRestricted(target));
          yield* commands
            .liftRestriction(target.user.id, Option.none())
            .pipe(asAdmin(root));
          assert.isFalse(yield* isRestricted(target));
        }),
      );

      it.effect("fails with UserNotFound for an unknown id", () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const admin = yield* member("admin");
          const error = yield* commands
            .liftRestriction(unknownId, Option.none())
            .pipe(asAdmin(admin), Effect.flip);
          assert.deepStrictEqual(
            error,
            new UserNotFound({ userId: unknownId }),
          );
        }),
      );
    });
  });

  it.effect(
    "a superAdmin revoked meanwhile can't revoke the remaining one",
    () =>
      Effect.gen(function* () {
        const commands = yield* ModerationCommands;
        // The only two superAdmins of a fresh database.
        const first = yield* member("superAdmin");
        const second = yield* member("superAdmin");
        yield* commands
          .revokeRole(second.user.id, "superAdmin")
          .pipe(asSuperAdmin(first));

        // `second` still carries the proof of a request from before.
        const error = yield* commands
          .revokeRole(first.user.id, "superAdmin")
          .pipe(asSuperAdmin(second), Effect.flip);

        assert.instanceOf(error, Forbidden);
        assert.deepStrictEqual(yield* rolesOf(first), [
          "normalUser",
          "superAdmin",
        ]);
      }).pipe(Effect.provide(UsersTest)),
    { timeout: 30_000 },
  );
});

describe("moderation audit trail", () => {
  layer(UsersTest, { timeout: "30 seconds" })((it) => {
    it.effect(
      "records each moderation action with actor, target and role",
      () =>
        Effect.gen(function* () {
          const commands = yield* ModerationCommands;
          const sql = yield* SqlClient.SqlClient;
          const root = yield* member("admin", "superAdmin");
          const target = yield* member();
          yield* sql`DELETE FROM audit_log`;

          yield* commands
            .grantRole(target.user.id, "admin")
            .pipe(asSuperAdmin(root));
          yield* commands
            .revokeRole(target.user.id, "admin")
            .pipe(asSuperAdmin(root));
          // No change, nothing recorded.
          yield* commands
            .revokeRole(target.user.id, "admin")
            .pipe(asSuperAdmin(root));
          yield* commands
            .restrict(target.user.id, "a private note")
            .pipe(asAdmin(root));
          yield* commands
            .liftRestriction(target.user.id, Option.some("another note"))
            .pipe(asAdmin(root));

          const rows = yield* sql<{
            readonly action: string;
            readonly actorId: string;
            readonly targetId: string;
            readonly detail: string | null;
          }>`SELECT action, actor_id, target_id, detail FROM audit_log ORDER BY id`;
          assert.deepStrictEqual(
            rows.map(({ action, detail }) => [action, detail]),
            [
              ["role_granted", "admin"],
              ["role_revoked", "admin"],
              ["user_restricted", null],
              ["restriction_lifted", null],
            ],
          );
          for (const row of rows) {
            assert.strictEqual(row.actorId, root.user.id);
            assert.strictEqual(row.targetId, target.user.id);
          }
          // Notes are personal data and never reach the log.
          assert.notInclude(JSON.stringify(rows), "note");
        }),
    );

    it.effect("records nothing for a refused action", () =>
      Effect.gen(function* () {
        const commands = yield* ModerationCommands;
        const sql = yield* SqlClient.SqlClient;
        const admin = yield* member("admin");
        yield* sql`DELETE FROM audit_log`;
        const exit = yield* commands
          .restrict(admin.user.id, "myself")
          .pipe(asAdmin(admin), Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
        assert.strictEqual((yield* sql`SELECT 1 FROM audit_log`).length, 0);
      }),
    );
  });
});

describe("moderation in UserQueries", () => {
  it.effect(
    "listUsers pages through all users by registration, then id",
    () =>
      Effect.gen(function* () {
        const queries = yield* UserQueries;
        const commands = yield* ModerationCommands;
        const sql = yield* SqlClient.SqlClient;
        const admin = yield* member("admin");
        yield* TestClock.adjust("1 hour");
        const restricted = yield* member();
        yield* commands.restrict(restricted.user.id, "x").pipe(asAdmin(admin));
        yield* TestClock.adjust("1 hour");
        const tied = [yield* member(), yield* member("superAdmin")];
        // Registered at the same instant: ordered by id.
        yield* sql`
          UPDATE users SET created_at = ${DateTime.toDateUtc(tied[0]!.user.createdAt)}
          WHERE id = ${tied[1]!.user.id}
        `.pipe(Effect.orDie);
        const expected = [
          admin.user.id,
          restricted.user.id,
          ...tied.map(({ user }) => user.id).sort(),
        ];

        const all = yield* queries
          .listUsers({ limit: 50, after: Option.none() })
          .pipe(asAdmin(admin));
        assert.isTrue(Option.isNone(all.next));
        assert.deepStrictEqual(
          all.users.map(({ user }) => user.id),
          expected,
        );
        const byId = new Map(all.users.map((entry) => [entry.user.id, entry]));
        assert.deepStrictEqual(byId.get(admin.user.id)?.roles, [
          "admin",
          "normalUser",
        ]);
        assert.deepStrictEqual(byId.get(tied[1]!.user.id)?.roles, [
          "normalUser",
          "superAdmin",
        ]);
        const restrictedEntry = byId.get(restricted.user.id);
        const adminEntry = byId.get(admin.user.id);
        assert.isTrue(
          restrictedEntry !== undefined &&
            Option.isSome(restrictedEntry.restriction),
        );
        assert.isTrue(
          adminEntry !== undefined && Option.isNone(adminEntry.restriction),
        );
        // Keyset paging: each page starts after the last user of the one
        // before, and the last page has no next position.
        const first = yield* queries
          .listUsers({ limit: 2, after: Option.none() })
          .pipe(asAdmin(admin));
        assert.deepStrictEqual(
          first.users.map(({ user }) => user.id),
          expected.slice(0, 2),
        );
        assert.deepStrictEqual(
          first.next,
          Option.some({
            createdAt: first.users[1]!.user.createdAt,
            id: expected[1],
          }),
        );
        const second = yield* queries
          .listUsers({ limit: 2, after: first.next })
          .pipe(asAdmin(admin));
        assert.deepStrictEqual(
          second.users.map(({ user }) => user.id),
          expected.slice(2),
        );
        // A page that ends exactly at the last user has no next one.
        assert.isTrue(Option.isNone(second.next));
        const past = yield* queries
          .listUsers({
            limit: 2,
            after: Option.some({
              createdAt: second.users[1]!.user.createdAt,
              id: expected[3]!,
            }),
          })
          .pipe(asAdmin(admin));
        assert.deepStrictEqual(past, { users: [], next: Option.none() });
      }).pipe(Effect.provide(UsersTest)),
    { timeout: 30_000 },
  );

  layer(UsersTest, { timeout: "30 seconds" })((it) => {
    it.effect("getDetails returns the role change log oldest first", () =>
      Effect.gen(function* () {
        const queries = yield* UserQueries;
        const commands = yield* ModerationCommands;
        const root = yield* member("admin", "superAdmin");
        const target = yield* member();
        const registeredAt = target.user.createdAt;
        yield* TestClock.adjust("1 hour");
        yield* commands
          .grantRole(target.user.id, "admin")
          .pipe(asSuperAdmin(root));
        const grantedAt = yield* DateTime.now;
        yield* TestClock.adjust("1 hour");
        yield* commands
          .revokeRole(target.user.id, "admin")
          .pipe(asSuperAdmin(root));
        const revokedAt = yield* DateTime.now;

        const details = yield* queries
          .getDetails(target.user.id)
          .pipe(asAdmin(root));

        assert.strictEqual(details.user.id, target.user.id);
        assert.deepStrictEqual(details.roles, ["normalUser"]);
        assert.isTrue(Option.isNone(details.restriction));
        assert.deepStrictEqual(details.restrictions, []);
        assert.deepStrictEqual(
          details.roleChanges.map((change) => ({
            role: change.role,
            change: change.change,
            changedBy: change.changedBy,
            changedAt: millis(change.changedAt),
          })),
          [
            {
              role: "normalUser",
              change: "granted",
              changedBy: Option.none(),
              changedAt: millis(registeredAt),
            },
            {
              role: "admin",
              change: "granted",
              changedBy: Option.some(root.user.id),
              changedAt: millis(grantedAt),
            },
            {
              role: "admin",
              change: "revoked",
              changedBy: Option.some(root.user.id),
              changedAt: millis(revokedAt),
            },
          ],
        );
      }),
    );

    it.effect("getDetails fails with UserNotFound for an unknown id", () =>
      Effect.gen(function* () {
        const queries = yield* UserQueries;
        const admin = yield* member("admin");
        const error = yield* queries
          .getDetails(unknownId)
          .pipe(asAdmin(admin), Effect.flip);
        assert.deepStrictEqual(error, new UserNotFound({ userId: unknownId }));
      }),
    );
  });
});

describe("moderation of deleted accounts", () => {
  layer(UsersTest, { timeout: "30 seconds" })((it) => {
    it.effect("treats a user who deleted their account as not found", () =>
      Effect.gen(function* () {
        const commands = yield* ModerationCommands;
        const users = yield* UserCommands;
        const root = yield* member("admin", "superAdmin");
        const gone = yield* member();
        yield* users.deleteAccount(gone.subject);

        const errors = [
          yield* commands
            .grantRole(gone.user.id, "superAdmin")
            .pipe(asSuperAdmin(root), Effect.flip),
          yield* commands
            .revokeRole(gone.user.id, "admin")
            .pipe(asSuperAdmin(root), Effect.flip),
          yield* commands
            .restrict(gone.user.id, "x")
            .pipe(asAdmin(root), Effect.flip),
          yield* commands
            .liftRestriction(gone.user.id, Option.none())
            .pipe(asAdmin(root), Effect.flip),
        ];
        for (const error of errors) {
          assert.instanceOf(error, UserNotFound);
        }
        // Nothing was granted: the tombstone has no roles.
        assert.deepStrictEqual(yield* rolesOf(gone), []);
      }),
    );
  });
});
