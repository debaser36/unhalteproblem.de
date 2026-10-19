import { Authorized, type Role } from "@unhalteproblem.de/api";
import { Effect, Layer, Option, PubSub } from "effect";
import { SqlClient } from "effect/sql";
import { DomainEvents } from "#cqrs/DomainEvent";
import { Transaction } from "#cqrs/Transaction";
import type { User } from "#domains/users/User";
import { type Login, UserCommands } from "#domains/users/UserCommands";
import { AuditCommands } from "#domains/audit/AuditCommands";
import { AuditRepository } from "#domains/audit/AuditRepository";
import { ModerationCommands } from "#domains/moderation/ModerationCommands";
import { ModerationQueries } from "#domains/moderation/ModerationQueries";
import { ModerationRepository } from "#domains/moderation/ModerationRepository";
import { UserDirectory } from "#domains/users/UserDirectory";
import { UserQueries } from "#domains/users/UserQueries";
import { UserRepository } from "#domains/users/UserRepository";
import { Sessions } from "#repositories/Sessions";
import { DatabaseTest } from "./Database.ts";

/**
 * The users domain on a fresh in-memory database, for tests of its commands
 * and queries. Test support only, like everything in `#testing/*`.
 */

/** `Transaction` and `DomainEvents` on a fresh in-memory database. */
export const KernelTest = Transaction.layer.pipe(
  Layer.provideMerge(DomainEvents.layer),
  Layer.provideMerge(DatabaseTest),
);

/**
 * The users and moderation domains' commands and queries with their
 * repositories, `UserDirectory` and `Sessions`, all of which stay accessible
 * to the test, on `KernelTest`.
 */
export const UsersTest = Layer.mergeAll(
  UserCommands.layer,
  UserQueries.layer,
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(ModerationCommands.layer, ModerationQueries.layer),
  ),
  Layer.provideMerge(AuditCommands.layer),
  Layer.provideMerge(UserDirectory.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      AuditRepository.layer,
      UserRepository.layer,
      ModerationRepository.layer,
      Sessions.layer,
    ),
  ),
  Layer.provideMerge(KernelTest),
);

/** A login of `subject` with a full profile, parts of which can be replaced. */
export const login = (
  subject: string,
  overrides: Partial<Login["profile"]> = {},
) =>
  ({
    subject,
    profile: {
      username: Option.some("ada"),
      name: Option.some("Ada Lovelace"),
      email: Option.some("ada@example.org"),
      emailVerified: true,
      ...overrides,
    },
  }) satisfies Login;

/** Subscribes now; `take` returns what was published since. */
export const published = Effect.gen(function* () {
  const domainEvents = yield* DomainEvents;
  const subscription = yield* domainEvents.subscribe;
  return { take: PubSub.takeUpTo(subscription, 100) };
});

/** A registered user and the roles they hold. */
export interface Member {
  readonly user: User;
  readonly subject: string;
  readonly roles: ReadonlyArray<Role>;
}

/**
 * Registers a user with a random subject and grants `roles` on top of
 * `normalUser` directly in SQL, as an operator would: no role change log,
 * no events.
 */
export const member = (...roles: ReadonlyArray<Role>) =>
  Effect.gen(function* () {
    const commands = yield* UserCommands;
    const sql = yield* SqlClient.SqlClient;
    const subject = crypto.randomUUID();
    const user = yield* commands.syncFromLogin(login(subject));
    const extra = roles.filter((role) => role !== "normalUser");
    for (const role of extra) {
      yield* sql`
        INSERT INTO user_roles (user_id, role) VALUES (${user.id}, ${role})
      `.pipe(Effect.orDie);
    }
    return {
      user,
      subject,
      roles: [...new Set<Role>(["normalUser", ...extra])].sort(),
    } satisfies Member;
  });

const proof = <R extends Role>(actor: Member, role: R) => ({
  user: { id: actor.subject, roles: actor.roles },
  roles: [role] as const,
});

/**
 * Runs an admin command or query as `actor`, as if `RequireAdmin` had
 * checked them: provides `Authorized<"admin">` with the actor's roles,
 * without checking that they hold `admin`.
 */
export const asAdmin =
  (actor: Member) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.provideService(self, Authorized("admin"), proof(actor, "admin"));

/** Like `asAdmin`, for `Authorized<"superAdmin">`. */
export const asSuperAdmin =
  (actor: Member) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.provideService(
      self,
      Authorized("superAdmin"),
      proof(actor, "superAdmin"),
    );
