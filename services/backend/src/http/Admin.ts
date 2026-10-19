import {
  type AdminUser,
  type AdminUserDetails,
  Api,
  type Restriction as RestrictionDto,
  type RoleChange as RoleChangeDto,
} from "@unhalteproblem.de/api";
import { Effect, Option } from "effect";
import { HttpEffect, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import type { Restriction, RoleChange } from "#domains/moderation/Moderation";
import { ModerationCommands } from "#domains/moderation/ModerationCommands";
import {
  type UserDetails,
  type UserOverview,
  UserQueries,
} from "#domains/users/UserQueries";

/** Personal data of other users: no cache may keep the response. */
const noStore = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.succeed(
      HttpServerResponse.setHeader(response, "cache-control", "no-store"),
    ),
  ).pipe(Effect.andThen(self));

const toRestriction = (restriction: Restriction): RestrictionDto => ({
  id: restriction.id,
  note: restriction.note,
  restrictedBy: Option.getOrNull(restriction.restrictedBy),
  restrictedAt: restriction.restrictedAt,
  liftedAt: Option.getOrNull(restriction.liftedAt),
  liftedBy: Option.getOrNull(restriction.liftedBy),
  liftNote: Option.getOrNull(restriction.liftNote),
});

const toRoleChange = (change: RoleChange): RoleChangeDto => ({
  role: change.role,
  change: change.change,
  changedBy: Option.getOrNull(change.changedBy),
  changedAt: change.changedAt,
});

const toAdminUser = ({
  user,
  roles,
  restriction,
}: UserOverview): AdminUser => ({
  id: user.id,
  subject: user.subject,
  username: Option.getOrNull(user.username),
  name: Option.getOrNull(user.name),
  email: Option.getOrNull(user.email),
  emailVerified: user.emailVerified,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  lastLoginAt: user.lastLoginAt,
  deletedAt: Option.getOrNull(user.deletedAt),
  roles,
  restriction: Option.getOrNull(Option.map(restriction, toRestriction)),
});

const toAdminUserDetails = (details: UserDetails): AdminUserDetails => ({
  ...toAdminUser(details),
  restrictions: details.restrictions.map(toRestriction),
  roleChanges: details.roleChanges.map(toRoleChange),
});

/**
 * The admin API. Each endpoint's `RequireRoles` middleware provides the
 * proof its command or query requires, so the handlers only translate
 * between the domain and the contract.
 */
export const AdminHandlers = HttpApiBuilder.group(
  Api,
  "admin",
  Effect.fn(function* (handlers) {
    const commands = yield* ModerationCommands;
    const queries = yield* UserQueries;
    return handlers
      .handle("listUsers", ({ query }) =>
        queries
          .listUsers({
            limit: query.limit,
            after: Option.fromUndefinedOr(query.cursor),
          })
          .pipe(
            noStore,
            Effect.map(({ users, next }) => ({
              users: users.map(toAdminUser),
              nextCursor: Option.getOrNull(next),
            })),
          ),
      )
      .handle("getUser", ({ params }) =>
        queries
          .getDetails(params.userId)
          .pipe(Effect.map(toAdminUserDetails), noStore),
      )
      .handle("restrictUser", ({ params, payload }) =>
        commands
          .restrict(params.userId, payload.note)
          .pipe(Effect.map(toRestriction)),
      )
      .handle("liftRestriction", ({ params, payload }) =>
        commands
          .liftRestriction(params.userId, Option.fromUndefinedOr(payload.note))
          .pipe(Effect.map(toRestriction)),
      )
      .handle("grantRole", ({ params }) =>
        commands.grantRole(params.userId, params.role),
      )
      .handle("revokeRole", ({ params }) =>
        commands.revokeRole(params.userId, params.role),
      );
  }),
);
