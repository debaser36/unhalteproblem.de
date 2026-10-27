import { fileURLToPath } from "node:url";

export const origin = "http://localhost:5173";

/** The blog the editor tests write in; the global setup creates it. */
export const e2eBlog = "e2e";

/** The users the global setup logs in, with their roles. */
export const users = {
  "e2e-admin": `normalUser,admin,blogEditor:${e2eBlog}`,
  "e2e-user": "normalUser",
} as const;

export type TestUser = keyof typeof users;

/** The saved login of `user`, for `test.use({ storageState })`. */
export const authFile = (user: string) =>
  fileURLToPath(new URL(`./.auth/${user}.json`, import.meta.url));
