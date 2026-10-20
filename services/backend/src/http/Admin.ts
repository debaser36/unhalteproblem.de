import {
  type AdminUser,
  type AdminUserDetails,
  Api,
  type Restriction as RestrictionDto,
  type RoleChange as RoleChangeDto,
} from "@unhalteproblem.de/api";
import { Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { BlogCommands } from "#domains/blogs/BlogCommands";
import type { Restriction, RoleChange } from "#domains/moderation/Moderation";
import { ModerationCommands } from "#domains/moderation/ModerationCommands";
import {
  type UserDetails,
  type UserOverview,
  UserQueries,
} from "#domains/users/UserQueries";
import { toBlog } from "./BlogViews.ts";
import { noStore } from "./CacheControl.ts";

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
    const blogs = yield* BlogCommands;
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
      )
      .handle("createBlog", ({ payload }) =>
        blogs.createBlog(payload).pipe(Effect.map(toBlog), noStore),
      )
      .handle("updateBlog", ({ params, payload }) =>
        blogs
          .updateBlog(params.blog, payload)
          .pipe(Effect.map(toBlog), noStore),
      );
  }),
);
