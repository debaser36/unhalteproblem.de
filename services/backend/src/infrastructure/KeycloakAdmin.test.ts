import { assert, describe, it } from "@effect/vitest";
import { Cause, ConfigProvider, Effect, Exit, Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/http";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { KeycloakAdmin, KeycloakAdminFailed } from "./KeycloakAdmin.ts";

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: string;
}

/** A Keycloak that answers the token request and the user deletion as told. */
const fakeKeycloak = (answers: {
  readonly token: number;
  readonly deleteUser: number;
}) =>
  Effect.acquireRelease(
    Effect.callback<{
      readonly port: number;
      readonly seen: Array<Seen>;
      readonly server: Server;
    }>((resume) => {
      const seen: Array<Seen> = [];
      const server = createServer((request: IncomingMessage, response) => {
        let body = "";
        request.on("data", (chunk) => (body += chunk));
        request.on("end", () => {
          seen.push({
            method: request.method ?? "",
            url: request.url ?? "",
            authorization: request.headers.authorization,
            body,
          });
          if (request.url?.endsWith("/protocol/openid-connect/token")) {
            response.writeHead(answers.token, {
              "content-type": "application/json",
            });
            response.end(
              answers.token === 200
                ? JSON.stringify({ access_token: "service-token" })
                : JSON.stringify({ error: "secret-details" }),
            );
          } else {
            response.writeHead(answers.deleteUser);
            response.end("user ada@example.org is not allowed");
          }
        });
      });
      server.listen(0, "127.0.0.1", () =>
        resume(
          Effect.succeed({
            port: (server.address() as { port: number }).port,
            seen,
            server,
          }),
        ),
      );
    }),
    ({ server }) =>
      Effect.callback<void>((resume) => {
        server.close(() => resume(Effect.void));
        server.closeAllConnections();
      }),
  );

const run = (port: number, subject: string) =>
  KeycloakAdmin.use((keycloak) => keycloak.deleteUser(subject)).pipe(
    Effect.provide(
      KeycloakAdmin.layerWith({
        issuer: `http://127.0.0.1:${port}/realms/test`,
        clientId: "backend",
        clientSecret: Redacted.make("s3 cret:/+"),
      }).pipe(Layer.provide(FetchHttpClient.layer)),
    ),
  );

describe("KeycloakAdmin.deleteUser", () => {
  it.live("authenticates as the client and deletes the user by id", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { port, seen } = yield* fakeKeycloak({
          token: 200,
          deleteUser: 204,
        });
        yield* run(port, "8f3c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b");

        const [token, deletion] = seen;
        assert.strictEqual(token?.method, "POST");
        assert.strictEqual(
          token?.url,
          "/realms/test/protocol/openid-connect/token",
        );
        assert.strictEqual(token?.body, "grant_type=client_credentials");
        // client_secret_basic, credentials URL-encoded first (RFC 6749 2.3.1).
        assert.strictEqual(
          token?.authorization,
          `Basic ${Buffer.from("backend:s3+cret%3A%2F%2B").toString("base64")}`,
        );
        assert.strictEqual(deletion?.method, "DELETE");
        assert.strictEqual(
          deletion?.url,
          "/admin/realms/test/users/8f3c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b",
        );
        assert.strictEqual(deletion?.authorization, "Bearer service-token");
      }),
    ),
  );

  it.live("treats a user that is gone already as deleted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { port } = yield* fakeKeycloak({ token: 200, deleteUser: 404 });
        yield* run(port, "someone");
      }),
    ),
  );

  it.live("fails with a status code and nothing from the response", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { port } = yield* fakeKeycloak({ token: 200, deleteUser: 403 });
        const error = yield* run(port, "someone").pipe(Effect.flip);
        assert.instanceOf(error, KeycloakAdminFailed);
        assert.strictEqual(error.reason, "delete:403");
        assert.notInclude(JSON.stringify(error), "ada@example.org");
      }),
    ),
  );

  it.live("fails when the token request is refused", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { port, seen } = yield* fakeKeycloak({
          token: 401,
          deleteUser: 204,
        });
        const error = yield* run(port, "someone").pipe(Effect.flip);
        assert.strictEqual(error.reason, "token:401");
        assert.notInclude(JSON.stringify(error), "secret-details");
        // Without a token no deletion is attempted.
        assert.strictEqual(seen.length, 1);
      }),
    ),
  );

  it.live("fails with a transport code when Keycloak is unreachable", () =>
    Effect.gen(function* () {
      const port = yield* Effect.scoped(
        Effect.gen(function* () {
          const { port } = yield* fakeKeycloak({ token: 200, deleteUser: 204 });
          return port;
        }),
      );
      const error = yield* run(port, "someone").pipe(Effect.flip);
      assert.strictEqual(error.reason, "token:transport");
    }),
  );
});

describe("KeycloakAdmin.layer", () => {
  const build = (env: Record<string, string>) =>
    Layer.build(KeycloakAdmin.layer).pipe(
      Effect.scoped,
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
      Effect.exit,
    );

  it.effect("refuses to be the login client", () =>
    Effect.gen(function* () {
      const exit = yield* build({
        OIDC_CLIENT_SECRET: "login",
        KEYCLOAK_ADMIN_CLIENT_ID: "unhalteproblem-backend",
        KEYCLOAK_ADMIN_CLIENT_SECRET: "admin",
      });
      assert.isTrue(Exit.isFailure(exit));
      assert.include(
        Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "",
        "must be another client",
      );
    }),
  );

  it.effect("starts with a client of its own", () =>
    Effect.gen(function* () {
      const exit = yield* build({
        OIDC_CLIENT_SECRET: "login",
        KEYCLOAK_ADMIN_CLIENT_SECRET: "admin",
      });
      assert.isTrue(Exit.isSuccess(exit));
    }),
  );
});
