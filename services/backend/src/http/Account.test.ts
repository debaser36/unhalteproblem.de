import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  login,
  loginResponse,
  makeAppWithServices,
  session,
  setCookie,
  site,
} from "#testing/App";
import { makeRecordingKeycloak } from "#testing/KeycloakAdmin";

const deleteAccount = (
  request: (path: string, init?: RequestInit) => Effect.Effect<Response>,
  cookie: string,
  headers: Record<string, string> = { origin: site },
) =>
  request("/account/delete", {
    method: "POST",
    headers: { ...headers, cookie: `__Host-session=${cookie}` },
  });

describe("account deletion", () => {
  it.effect("deletes the account, ends the session and blocks the login", () =>
    Effect.gen(function* () {
      const keycloak = makeRecordingKeycloak();
      const { request, sql } = yield* makeAppWithServices({
        keycloak: keycloak.layer,
      });
      const cookie = yield* login(request);
      assert.strictEqual((yield* session(request, cookie)).status, 200);

      const response = yield* deleteAccount(request, cookie);
      assert.strictEqual(response.status, 204);
      assert.strictEqual(response.headers.get("cache-control"), "no-store");
      assert.include(setCookie(response, "__Host-session") ?? "", "Max-Age=0");

      // The session is gone, and so is the way back in.
      assert.strictEqual((yield* session(request, cookie)).status, 401);
      const again = yield* loginResponse(request);
      assert.include(
        again.headers.get("location") ?? "",
        "login_error=restricted",
      );

      // The row is a tombstone without personal data.
      const [user] = yield* sql(
        (sql) =>
          sql<{
            readonly username: string | null;
            readonly name: string | null;
            readonly email: string | null;
            readonly deletedAt: Date | null;
          }>`SELECT username, name, email, deleted_at FROM users`,
      );
      assert.deepStrictEqual(
        [user?.username, user?.name, user?.email],
        [null, null, null],
      );
      assert.isNotNull(user?.deletedAt);
      // Keycloak is to be told through the outbox, once, by id.
      const queued = yield* sql(
        (sql) => sql<{ readonly subject: string }>`
          SELECT payload->>'subject' AS subject FROM outbox
          WHERE topic = 'account.delete-keycloak-user'
        `,
      );
      assert.deepStrictEqual(
        queued.map(({ subject }) => subject).length + keycloak.deleted.length,
        1,
      );
    }).pipe(Effect.scoped),
  );

  it.effect("needs a session", () =>
    Effect.gen(function* () {
      const { request } = yield* makeAppWithServices();
      const response = yield* request("/account/delete", {
        method: "POST",
        headers: { origin: site },
      });
      assert.strictEqual(response.status, 401);
    }).pipe(Effect.scoped),
  );

  it.effect.each<readonly [string, Record<string, string>]>([
    ["a foreign origin", { origin: "https://evil.example" }],
    ["no origin", {}],
  ])("refuses %s and keeps the account", ([, headers]) =>
    Effect.gen(function* () {
      const { request, sql } = yield* makeAppWithServices();
      const cookie = yield* login(request);
      const response = yield* deleteAccount(request, cookie, headers);
      assert.strictEqual(response.status, 403);
      assert.strictEqual((yield* session(request, cookie)).status, 200);
      const rows = yield* sql(
        (sql) => sql`SELECT 1 FROM users WHERE deleted_at IS NOT NULL`,
      );
      assert.strictEqual(rows.length, 0);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses a superAdmin with 409 and keeps the session", () =>
    Effect.gen(function* () {
      const { request, sql } = yield* makeAppWithServices();
      const cookie = yield* login(request);
      yield* sql(
        (sql) => sql`
          INSERT INTO user_roles (user_id, role)
          SELECT id, 'superAdmin' FROM users WHERE subject = 'user-1'
        `,
      );
      const response = yield* deleteAccount(request, cookie);
      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual(yield* Effect.promise(() => response.json()), {
        _tag: "AccountDeletionNotAllowed",
        reason: "superAdmin",
      });
      // The cookie stays: the user is still logged in.
      assert.isUndefined(setCookie(response, "__Host-session"));
      assert.strictEqual((yield* session(request, cookie)).status, 200);
    }).pipe(Effect.scoped),
  );
});
