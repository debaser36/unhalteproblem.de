import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { authFile, e2eBlog, origin, users } from "./users.ts";

const stack = (...args: Array<string>) =>
  execFileSync("stack", args, { encoding: "utf8" }).trim();

/**
 * Starts the local stack (a no-op when it runs already), logs in the test
 * users through `stack login` (there is no Keycloak locally) and makes sure
 * the blog the editor tests write in exists.
 */
export default async function globalSetup() {
  stack("up");
  mkdirSync(new URL("./.auth/", import.meta.url), { recursive: true });
  const cookies: Record<string, string> = {};
  for (const [name, roles] of Object.entries(users)) {
    // Prints `__Host-session=<value>`. Logging in again ends the user's
    // earlier sessions, so each user logs in once.
    const cookie = stack("login", name, roles);
    cookies[name] = cookie;
    const [cookieName = "", value = ""] = cookie.split("=");
    writeFileSync(
      authFile(name),
      JSON.stringify({
        cookies: [
          {
            name: cookieName,
            value,
            domain: "localhost",
            path: "/",
            expires: -1,
            httpOnly: true,
            // Chromium accepts `Secure` (and so `__Host-`) on localhost.
            secure: true,
            sameSite: "Lax",
          },
        ],
        origins: [],
      }),
    );
  }
  await ensureBlog(cookies["e2e-admin"] ?? "");
}

const ensureBlog = async (cookie: string) => {
  // 127.0.0.1: Node may resolve localhost to ::1, where Vite doesn't listen.
  const response = await fetch(
    new URL("/api/admin/blogs", origin.replace("localhost", "127.0.0.1")),
    {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify({
        slug: e2eBlog,
        title: "End-to-end",
        description: "Written by the end-to-end tests.",
        categories: { main: "Testing", extra: [] },
      }),
    },
  );
  // 409: it exists from an earlier run.
  if (response.status !== 201 && response.status !== 409) {
    throw new Error(
      `creating the e2e blog failed: ${response.status} ${await response.text()}`,
    );
  }
};
