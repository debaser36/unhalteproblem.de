import { assert } from "@effect/vitest";
import {
  Api,
  RequireAdmin,
  RequireBlogRequestModerator,
  RequireSuperAdmin,
} from "@unhalteproblem.de/api";
import {
  AccessToken,
  IdToken,
  type TokenResponse,
} from "@unhalteproblem.de/oidc";
import { NodeHttpServer } from "@effect/platform-node";
import { ByteSize, Context, Effect, Layer, Redacted, Schema } from "effect";
import { HttpIncomingMessage, HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { SqlClient } from "effect/sql";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  SignJWT,
} from "jose";
import * as Authorization from "#auth/Authorization";
import { pkceChallenge } from "#auth/Secrets";
import { DomainsLive } from "#domains/Domains";
import { AccountHandlers } from "#http/Account";
import { AdminHandlers } from "#http/Admin";
import { AdminInsightsHandlers } from "#http/AdminInsights";
import { AuthHandlers } from "#http/Auth";
import { AuthenticationLive } from "#http/Authentication";
import { BlogEditorHandlers } from "#http/BlogEditor";
import {
  BlogRequestAdminHandlers,
  BlogRequestsHandlers,
} from "#http/BlogRequests";
import { BlogsHandlers } from "#http/Blogs";
import { ContactHandlers } from "#http/Contact";
import { LargeBodyLive } from "#http/LargeBody";
import { MediaHandlers } from "#http/Media";
import { ProjectAdminHandlers } from "#http/ProjectAdmin";
import { ProjectsHandlers } from "#http/Projects";
import { SameOriginLive } from "#http/SameOrigin";
import { SeoHandlers } from "#http/Seo";
import { SystemHandlers } from "#http/System";
import { LoginAttempts } from "#repositories/LoginAttempts";
import { LogoutTokens } from "#repositories/LogoutTokens";
import { Sessions } from "#repositories/Sessions";
import { ContactRateLimit } from "#services/ContactRateLimit";
import { LoginRateLimit } from "#services/LoginRateLimit";
import { KeycloakAdmin } from "#services/KeycloakAdmin";
import { Mailer } from "#services/Mailer";
import { CodeExchangeFailed, OidcProvider } from "#services/OidcProvider";
import { Readiness } from "#services/Readiness";
import { TokenVerifier } from "#services/TokenVerifier";
import { DatabaseTest } from "./Database.ts";
import { makeRecordingKeycloak } from "./KeycloakAdmin.ts";
import { createServer, request as httpRequest } from "node:http";

/**
 * The whole backend as an HTTP app on a fresh in-memory database, with a
 * fake identity provider, for end-to-end tests of the endpoints. Test
 * support only, like everything in `#testing/*`.
 */

// The defaults of PUBLIC_ORIGIN and the API URL, which the handlers use.
export const site = "https://unhalteproblem.de";
export const api = "http://backend.test";

export const issuer = "https://auth.example.org/realms/test";
export const clientId = "backend";

/** The subject the fake provider logs in when a test names none. */
export const defaultSubject = "user-1";

const key = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(key.publicKey)), kid: "k1", alg: "RS256" };

/** Now in seconds, for JWT timestamps. */
export const now = () => Math.floor(Date.now() / 1000);

/** Signs a JWT with the fake provider's key. */
export const sign = (payload: JWTPayload) =>
  new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .sign(key.privateKey);

/**
 * The authorization code the fake provider accepts for a login: the login's
 * state, followed by `:subject` to log in as someone other than
 * `defaultSubject`. States are base64url, so they never contain `:`.
 */
export const authorizationCode = (state: string, subject?: string) =>
  subject === undefined ? state : `${state}:${subject}`;

export interface AppOptions {
  /** Changes the nonce the provider puts into the ID token. */
  readonly nonce?: (nonce: string) => string;
  /** The ID token's `sid`; `null` leaves it out. */
  readonly sid?: string | null;
  /** Where the owner's mails go; by default nowhere (see `makeRecordingMailer`). */
  readonly mailer?: Layer.Layer<Mailer>;
  /** Stands in for Keycloak's admin API; by default it accepts everything (see `makeRecordingKeycloak`). */
  readonly keycloak?: Layer.Layer<KeycloakAdmin>;
  /** Login starts allowed per client. */
  readonly loginLimit?: number;
  /**
   * Serves the app over a real Node HTTP server on an ephemeral port, with
   * this request body limit in KiB (as `Server.ts` sets it), instead of a web
   * handler. Only the Node server enforces body limits, so tests of them
   * need this.
   */
  readonly maxBodyKibibytes?: number;
}

/**
 * Stands in for Keycloak: records the authentication requests and, on code
 * exchange, checks PKCE and issues an ID token for the login's nonce and
 * the subject named in the code (see `authorizationCode`).
 */
const makeProvider = (options: AppOptions) => {
  const logins = new Map<string, { nonce: string; codeChallenge: string }>();
  const provider = OidcProvider.of({
    issuer,
    redirectUri: `${api}/auth/callback`,
    authorizationUrl: ({ state, nonce, codeChallenge, prompt }) =>
      Effect.sync(() => {
        logins.set(state, { nonce, codeChallenge });
        const query = new URLSearchParams({ state });
        if (prompt !== undefined) query.set("prompt", prompt);
        return `${issuer}/auth?${query}`;
      }),
    exchangeCode: ({ code, codeVerifier }) =>
      Effect.gen(function* () {
        const value = Redacted.value(code);
        const separator = value.indexOf(":");
        const state = separator === -1 ? value : value.slice(0, separator);
        const subject =
          separator === -1 ? defaultSubject : value.slice(separator + 1);
        const login = logins.get(state);
        if (
          login === undefined ||
          pkceChallenge(Redacted.value(codeVerifier)) !== login.codeChallenge
        ) {
          return yield* new CodeExchangeFailed({ reason: "invalid_grant" });
        }
        const idToken = yield* Effect.promise(() =>
          sign({
            iss: issuer,
            sub: subject,
            aud: clientId,
            iat: now(),
            exp: now() + 300,
            nonce: options.nonce?.(login.nonce) ?? login.nonce,
            ...(options.sid === null
              ? {}
              : { sid: options.sid ?? "kc-session-1" }),
            preferred_username: "ada",
            email: "ada@example.org",
            email_verified: true,
          }),
        );
        const response: TokenResponse = {
          access_token: yield* Schema.decodeEffect(AccessToken)("at").pipe(
            Effect.orDie,
          ),
          token_type: "Bearer",
          id_token: yield* Schema.decodeEffect(IdToken)(idToken).pipe(
            Effect.orDie,
          ),
        };
        return response;
      }),
    endSessionUrl: Effect.succeed(`${issuer}/logout`),
  });
  return provider;
};

/** Sends a request to the app; `path` is relative to the API URL. */
export type AppRequest = (
  path: string,
  init?: RequestInit,
) => Effect.Effect<Response>;

/** Requests to `app` through a web handler, which enforces no body limit. */
const webRequest = <E>(app: Layer.Layer<never, E, HttpRouter.HttpRouter>) =>
  Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => HttpRouter.toWebHandler(app, { disableLogger: true })),
      ({ dispose }) => Effect.promise(dispose),
    ),
    ({ handler }): AppRequest =>
      (path, init) =>
        Effect.promise(() => handler(new Request(`${api}${path}`, init))),
  );

/**
 * Requests to `app`, served by a Node HTTP server on an ephemeral port with
 * the body limit `maxBodyKibibytes`. Redirects are not followed, as with the web
 * handler.
 */
const nodeRequest = Effect.fnUntraced(function* <E>(
  app: Layer.Layer<never, E, HttpRouter.HttpRouter>,
  maxBodyKibibytes: number,
) {
  const context = yield* Layer.build(
    HttpRouter.serve(app, {
      disableLogger: true,
      disableListenLog: true,
    }).pipe(
      Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
      Layer.provide(
        Layer.succeed(
          HttpIncomingMessage.MaxBodySize,
          ByteSize.kibibytes(maxBodyKibibytes),
        ),
      ),
    ),
  ).pipe(Effect.orDie);
  const address = Context.get(context, HttpServer.HttpServer).address;
  if (!("port" in address)) {
    return yield* Effect.die(new Error("Test server without a TCP port"));
  }
  const base = `http://127.0.0.1:${address.port}`;
  const request: AppRequest = (path, init = {}) =>
    Effect.promise(() => sendNode(`${base}${path}`, init));
  return request;
});

/**
 * Sends a request with `node:http` instead of `fetch`: when the server
 * answers early (a body over the limit) and closes the connection, `fetch`
 * fails with ECONNRESET, while this still returns the response. Bodies are
 * strings or bytes, as `#testing/*` sends them.
 */
const sendNode = (url: string, init: RequestInit) =>
  new Promise<Response>((resolve, reject) => {
    const body =
      init.body === undefined || init.body === null
        ? undefined
        : typeof init.body === "string"
          ? Buffer.from(init.body)
          : init.body instanceof Uint8Array
            ? Buffer.from(init.body)
            : undefined;
    if (init.body != null && body === undefined) {
      return reject(new Error("Only string and byte bodies are supported"));
    }
    const headers = new Headers(init.headers);
    if (body !== undefined) headers.set("content-length", String(body.length));
    let answered = false;
    const outgoing = httpRequest(
      url,
      { method: init.method ?? "GET", headers: Object.fromEntries(headers) },
      (incoming) => {
        answered = true;
        const chunks: Array<Buffer> = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("error", reject);
        incoming.on("end", () => {
          const responseHeaders = new Headers();
          const raw = incoming.rawHeaders;
          for (let index = 0; index < raw.length; index += 2) {
            responseHeaders.append(raw[index]!, raw[index + 1]!);
          }
          const status = incoming.statusCode ?? 500;
          const empty = status === 204 || status === 304;
          resolve(
            new Response(empty ? null : Buffer.concat(chunks), {
              status,
              headers: responseHeaders,
            }),
          );
        });
      },
    );
    // Writing the rest of a refused body fails once the server has closed;
    // the response has arrived by then.
    outgoing.on("error", (error) => {
      if (!answered) reject(error);
    });
    outgoing.end(body);
  });

/**
 * The backend's HTTP app with a fresh in-memory database, and the services
 * behind it (database, repositories, domains) for checking stored state.
 * Needs a `Scope`, which disposes of the app.
 */
export const makeAppWithServices = Effect.fnUntraced(function* (
  options: AppOptions = {},
) {
  const services = yield* Layer.build(
    Layer.mergeAll(
      LoginAttempts.layer,
      LogoutTokens.layer,
      DomainsLive.pipe(
        Layer.provide(options.mailer ?? Mailer.layerDisabled),
        Layer.provide(options.keycloak ?? makeRecordingKeycloak().layer),
        Layer.provideMerge(Sessions.layer),
      ),
    ).pipe(Layer.provideMerge(DatabaseTest)),
  );
  const repositories = Layer.succeedContext(services);
  const handlers = Layer.mergeAll(
    AuthHandlers,
    SystemHandlers,
    ContactHandlers,
    AdminHandlers,
    AdminInsightsHandlers,
    AccountHandlers,
    BlogsHandlers,
    BlogEditorHandlers,
    BlogRequestsHandlers,
    BlogRequestAdminHandlers,
    MediaHandlers,
    ProjectsHandlers,
    ProjectAdminHandlers,
    SeoHandlers,
  ).pipe(
    Layer.provide([
      SameOriginLive,
      LargeBodyLive,
      Authorization.blogEditorMiddleware,
      Authorization.middleware(RequireAdmin),
      Authorization.middleware(RequireSuperAdmin),
      Authorization.middleware(RequireBlogRequestModerator),
      Layer.succeed(OidcProvider, makeProvider(options)),
      TokenVerifier.layerWith({
        issuer,
        clientId,
        keys: createLocalJWKSet({ keys: [jwk] }),
      }),
      LoginRateLimit.layerWith({
        limit: options.loginLimit ?? 100,
        globalLimit: 1000,
        window: "1 hour",
      }),
      Readiness.layer,
      ContactRateLimit.layerWith({
        limit: 5,
        globalLimit: 5,
        window: "1 hour",
      }),
    ]),
    Layer.provideMerge(AuthenticationLive),
    Layer.provideMerge(repositories),
  );
  const app = HttpApiBuilder.layer(Api).pipe(
    Layer.provide(handlers),
    Layer.provide(HttpServer.layerServices),
  );
  const request: AppRequest =
    options.maxBodyKibibytes === undefined
      ? yield* webRequest(app)
      : yield* nodeRequest(app, options.maxBodyKibibytes);
  /** Runs SQL on the app's database; a failure fails the test. */
  const sql = <A>(
    statement: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown>,
  ) =>
    Effect.flatMap(SqlClient.SqlClient, statement).pipe(
      Effect.orDie,
      Effect.provide(services),
    );
  return { request, services, sql };
});

/** The backend's HTTP app with a fresh in-memory database. */
export const makeApp = (options: AppOptions = {}) =>
  Effect.map(makeAppWithServices(options), ({ request }) => request);

/** `name=value` of a `Set-Cookie` header, or undefined. */
export const setCookie = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`));

export const cookieValue = (response: Response, name: string) =>
  setCookie(response, name)
    ?.split(";")[0]
    ?.slice(name.length + 1);

/**
 * Runs `/auth/login` (or `/auth/register`) and returns the login cookie and
 * the state.
 */
export const startLogin = (
  request: AppRequest,
  returnTo = "/blog/post?x=1",
  endpoint: "login" | "register" = "login",
) =>
  Effect.gen(function* () {
    const response = yield* request(
      `/auth/${endpoint}?returnTo=${encodeURIComponent(returnTo)}`,
    );
    assert.strictEqual(response.status, 302);
    const location = new URL(response.headers.get("location") ?? "");
    const state = location.searchParams.get("state") ?? "";
    const loginCookie = cookieValue(response, "__Host-login") ?? "";
    return { response, state, loginCookie };
  });

export const callback = (
  request: AppRequest,
  query: Record<string, string>,
  loginCookie: string | undefined,
) =>
  request(`/auth/callback?${new URLSearchParams(query)}`, {
    headers:
      loginCookie === undefined
        ? {}
        : { cookie: `__Host-login=${loginCookie}` },
  });

/**
 * A login as `subject` (`defaultSubject` if absent) up to the callback's
 * response, whichever way it ends.
 */
export const loginResponse = (request: AppRequest, subject?: string) =>
  Effect.gen(function* () {
    const { state, loginCookie } = yield* startLogin(request);
    return yield* callback(
      request,
      { code: authorizationCode(state, subject), state, iss: issuer },
      loginCookie,
    );
  });

/**
 * A complete login as `subject` (`defaultSubject` if absent); returns the
 * session cookie value.
 */
export const login = (request: AppRequest, subject?: string) =>
  Effect.gen(function* () {
    const response = yield* loginResponse(request, subject);
    assert.strictEqual(response.status, 302);
    return cookieValue(response, "__Host-session") ?? "";
  });

export const session = (request: AppRequest, sessionCookie: string) =>
  request("/auth/session", {
    headers: { cookie: `__Host-session=${sessionCookie}` },
  });
