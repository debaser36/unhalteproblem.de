import type { UserCursor, UserId } from "@unhalteproblem.de/api";
import { ApiClient } from "#api/ApiClient.ts";

/** Reactivity key of everything that shows users (list and details). */
export const usersKey = "admin/users";

export const userPageAtom = (cursor: UserCursor | undefined) =>
  ApiClient.query("admin", "listUsers", {
    query: cursor === undefined ? { limit: 50 } : { limit: 50, cursor },
    reactivityKeys: [usersKey],
  });

export const userDetailsAtom = (userId: UserId) =>
  ApiClient.query("admin", "getUser", {
    params: { userId },
    reactivityKeys: [usersKey],
  });

export const restrictUser = ApiClient.mutation("admin", "restrictUser");
export const liftRestriction = ApiClient.mutation("admin", "liftRestriction");
export const grantRole = ApiClient.mutation("admin", "grantRole");
export const revokeRole = ApiClient.mutation("admin", "revokeRole");
