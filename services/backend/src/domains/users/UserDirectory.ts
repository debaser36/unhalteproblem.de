import type { Subject } from "@unhalteproblem.de/oidc";
import { Context, Effect, Layer, Option } from "effect";
import type { SqlError } from "effect/sql";
import type { User, UserId } from "./User.ts";
import { UserRepository } from "./UserRepository.ts";

/**
 * What other domains may ask of the users domain: find a user and lock them.
 * Everything else about storing users stays behind `UserRepository`.
 *
 * Moderation needs it to act on a user (the moderator and the target are
 * locked first); the users domain in turn uses moderation to grant the
 * initial roles. This service is the narrow part that keeps that from being
 * a cycle: it depends on nothing but the repository.
 */
export class UserDirectory extends Context.Service<
  UserDirectory,
  {
    /** The user with this OIDC `sub`, if they have ever logged in. */
    readonly findBySubject: (
      subject: typeof Subject.Type,
    ) => Effect.Effect<Option.Option<User>, SqlError.SqlError>;
    /**
     * The users with these ids (duplicates allowed), locked until the
     * transaction ends, in id order, so commands locking the same users
     * can't deadlock each other. Only call it inside a command.
     */
    readonly lockForUpdate: (
      ids: ReadonlyArray<UserId>,
    ) => Effect.Effect<ReadonlyArray<User>, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/users/UserDirectory") {
  /** Needs `UserRepository`. */
  static readonly layer = Layer.effect(
    UserDirectory,
    Effect.gen(function* () {
      const users = yield* UserRepository;
      return UserDirectory.of({
        findBySubject: users.findBySubject,
        lockForUpdate: users.lockForUpdate,
      });
    }),
  );
}

/**
 * Our id of the user behind an authorization proof (whose `user.id` is the
 * session's OIDC subject), for commands that record who acted. Every
 * session belongs to a user who has logged in since 0002, so a missing one
 * is a defect.
 */
export const actorIdOf = Effect.fnUntraced(function* (proof: {
  readonly user: { readonly id: string };
}) {
  const directory = yield* UserDirectory;
  const user = yield* directory.findBySubject(proof.user.id);
  if (Option.isNone(user)) {
    return yield* Effect.die(new Error("Acting user without a users row"));
  }
  return user.value.id;
});
