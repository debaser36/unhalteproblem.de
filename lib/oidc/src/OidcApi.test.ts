import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Redacted, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { HttpApiClient, OpenApi } from "effect/http-api";
import { OidcApi } from "./OidcApi.ts";
import {
  AccessToken,
  AuthorizationCode,
  ClientSecret,
  CodeVerifier,
  IdToken,
  layerClientSecretBasic,
  OAuthBadRequest,
  OAuthUnauthorized,
  RefreshToken,
  SignedUserInfo,
} from "./index.ts";

const issuer = "https://auth.example.org/realms/unhalteproblem";

// Credentials are branded, so they are created by decoding raw strings.
const accessToken = Schema.decodeSync(AccessToken);
const refreshToken = Schema.decodeSync(RefreshToken);
const idToken = Schema.decodeSync(IdToken);
const authorizationCode = Schema.decodeSync(AuthorizationCode);
const clientSecret = Schema.decodeSync(ClientSecret);
const codeVerifier = Schema.decodeSync(CodeVerifier);

const base64url = (value: string) =>
  btoa(value).replace(/=+$/u, "").replace(/\+/gu, "-").replace(/\//gu, "_");

const jwt = (header: object, payload: object, signature = "c2ln") =>
  `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}.${signature}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

interface Captured {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * An `HttpClient` standing in for Keycloak: records each request and
 * answers with `respond`. This exercises the real request encoding and
 * response decoding of the generated client.
 */
const fakeProvider = (respond: (request: Captured) => Response) => {
  const requests: Array<Captured> = [];
  const layer = Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) =>
      Effect.sync(() => {
        const captured: Captured = {
          method: request.method,
          url: request.url,
          headers: request.headers,
          body:
            request.body._tag === "Uint8Array"
              ? new TextDecoder().decode(request.body.body)
              : "",
        };
        requests.push(captured);
        return HttpClientResponse.fromWeb(request, respond(captured));
      }),
    ),
  );
  return { requests, layer };
};

const makeClient = HttpApiClient.make(OidcApi, { baseUrl: issuer });

describe("OpenAPI document", () => {
  const spec = OpenApi.fromApi(OidcApi);

  it("exposes Keycloak's endpoint paths", () => {
    assert.deepStrictEqual(Object.keys(spec.paths).sort(), [
      "/.well-known/openid-configuration",
      "/protocol/openid-connect/auth",
      "/protocol/openid-connect/certs",
      "/protocol/openid-connect/logout",
      "/protocol/openid-connect/revoke",
      "/protocol/openid-connect/token",
      "/protocol/openid-connect/token/introspect",
      "/protocol/openid-connect/userinfo",
    ]);
  });

  it("sends token requests form-encoded with optional basic auth", () => {
    const operation = spec.paths["/protocol/openid-connect/token"]?.post;
    assert.deepStrictEqual(Object.keys(operation?.requestBody?.content ?? {}), [
      "application/x-www-form-urlencoded",
    ]);
    assert.deepStrictEqual(Object.keys(operation?.responses ?? {}).sort(), [
      "200",
      "400",
      "401",
    ]);
    assert.deepStrictEqual(operation?.security, [{ clientSecretBasic: [] }]);
  });

  it("documents both userinfo representations", () => {
    const operation = spec.paths["/protocol/openid-connect/userinfo"]?.get;
    assert.deepStrictEqual(
      Object.keys(operation?.responses["200"]?.content ?? {}).sort(),
      ["application/json", "application/jwt"],
    );
  });
});

describe("browser URLs", () => {
  const urls = HttpApiClient.urlBuilder(OidcApi, { baseUrl: issuer });
  const request = {
    response_type: "code",
    client_id: "website",
    redirect_uri: "https://unhalteproblem.de/auth/callback",
    scope: ["openid", "email"],
    state: "state-1",
    nonce: "nonce-1",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
  } as const;

  it("builds the authorization URL below the issuer", () => {
    const url = new URL(urls.browser.authorize({ query: request }));
    assert.strictEqual(
      `${url.origin}${url.pathname}`,
      `${issuer}/protocol/openid-connect/auth`,
    );
    assert.strictEqual(url.searchParams.get("scope"), "openid email");
    assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
    assert.strictEqual(
      url.searchParams.get("redirect_uri"),
      request.redirect_uri,
    );
  });

  it("sends prompt as a space-delimited list, e.g. create", () => {
    const url = new URL(
      urls.browser.authorize({ query: { ...request, prompt: ["create"] } }),
    );
    assert.strictEqual(url.searchParams.get("prompt"), "create");
    const plain = new URL(urls.browser.authorize({ query: request }));
    assert.isFalse(plain.searchParams.has("prompt"));
  });

  it("refuses an authorization request without the openid scope", () => {
    assert.throws(() =>
      urls.browser.authorize({ query: { ...request, scope: ["email"] } }),
    );
  });

  it("builds the logout URL with an unwrapped id_token_hint", () => {
    const url = new URL(
      urls.browser.endSession({
        query: {
          id_token_hint: idToken("the-id-token"),
          post_logout_redirect_uri: "https://unhalteproblem.de/",
        },
      }),
    );
    assert.strictEqual(
      url.pathname,
      "/realms/unhalteproblem/protocol/openid-connect/logout",
    );
    assert.strictEqual(url.searchParams.get("id_token_hint"), "the-id-token");
  });

  it("refuses a post-logout redirect without id_token_hint or client_id", () => {
    assert.throws(() =>
      urls.browser.endSession({
        query: { post_logout_redirect_uri: "https://unhalteproblem.de/" },
      }),
    );
  });
});

describe("client against a Keycloak-shaped provider", () => {
  it.effect("decodes the discovery document and drops unknown fields", () => {
    const provider = fakeProvider(() =>
      json({
        issuer,
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
        userinfo_endpoint: `${issuer}/protocol/openid-connect/userinfo`,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`,
        end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
        response_types_supported: ["code", "none", "id_token"],
        subject_types_supported: ["public", "pairwise"],
        id_token_signing_alg_values_supported: ["RS256", "ES256"],
        code_challenge_methods_supported: ["plain", "S256"],
        backchannel_logout_supported: true,
        authorization_response_iss_parameter_supported: true,
        mtls_endpoint_aliases: { token_endpoint: "https://mtls.example" },
      }),
    );
    return Effect.gen(function* () {
      const client = yield* makeClient;
      const metadata = yield* client.discovery.configuration();
      assert.strictEqual(metadata.issuer, issuer);
      assert.isTrue(metadata.backchannel_logout_supported);
      assert.notProperty(metadata, "mtls_endpoint_aliases");
      assert.strictEqual(
        provider.requests[0]?.url,
        `${issuer}/.well-known/openid-configuration`,
      );
    }).pipe(Effect.provide(provider.layer));
  });

  it.effect("keeps JWKs of unknown types instead of failing the set", () => {
    const provider = fakeProvider(() =>
      json({
        keys: [
          {
            kid: "a",
            kty: "RSA",
            alg: "RS256",
            use: "sig",
            n: "AQAB",
            e: "AQAB",
          },
          {
            kid: "b",
            kty: "RSA",
            alg: "RSA-OAEP",
            use: "enc",
            n: "AQAB",
            e: "AQAB",
          },
          { kid: "c", kty: "PQC", alg: "ML-DSA-65", pub: "AAAA" },
        ],
      }),
    );
    return Effect.gen(function* () {
      const client = yield* makeClient;
      const { keys } = yield* client.discovery.keys();
      assert.deepStrictEqual(
        keys.map((key) => key.kid),
        ["a", "b", "c"],
      );
      assert.strictEqual(keys[2]?.["pub"], "AAAA");
    }).pipe(Effect.provide(provider.layer));
  });

  const tokenResponse = {
    access_token: "access-token",
    expires_in: 300,
    refresh_expires_in: 1800,
    refresh_token: "refresh-token",
    token_type: "Bearer",
    id_token: "id-token",
    "not-before-policy": 0,
    session_state: "session",
    scope: "openid email profile",
  };

  it.effect("exchanges a code with client_secret_basic", () => {
    const provider = fakeProvider(() => json(tokenResponse));
    return Effect.gen(function* () {
      const client = yield* makeClient.pipe(
        Effect.provide(
          layerClientSecretBasic({
            clientId: "backend",
            clientSecret: Redacted.make("s3cr:t+"),
          }),
        ),
      );
      const tokens = yield* client.token.grant({
        payload: {
          grant_type: "authorization_code",
          code: authorizationCode("the-code"),
          redirect_uri: "https://unhalteproblem.de/auth/callback",
          code_verifier: codeVerifier("v".repeat(43)),
        },
      });

      const request = provider.requests[0];
      assert.strictEqual(request?.method, "POST");
      assert.strictEqual(
        request?.url,
        `${issuer}/protocol/openid-connect/token`,
      );
      assert.strictEqual(
        request?.headers["content-type"],
        "application/x-www-form-urlencoded",
      );
      // The secret is form-encoded before Base64 (RFC 6749 §2.3.1).
      assert.strictEqual(
        request?.headers["authorization"],
        `Basic ${btoa("backend:s3cr%3At%2B")}`,
      );
      assert.deepStrictEqual(
        Object.fromEntries(new URLSearchParams(request?.body)),
        {
          grant_type: "authorization_code",
          code: "the-code",
          redirect_uri: "https://unhalteproblem.de/auth/callback",
          code_verifier: "v".repeat(43),
        },
      );

      assert.isTrue(Redacted.isRedacted(tokens.access_token));
      assert.strictEqual(Redacted.value(tokens.access_token), "access-token");
      assert.deepStrictEqual(tokens.scope, ["openid", "email", "profile"]);
      assert.notProperty(tokens, "refresh_expires_in");
    }).pipe(Effect.provide(provider.layer));
  });

  it.effect(
    "refreshes as a public client without an authorization header",
    () => {
      const provider = fakeProvider(() => json(tokenResponse));
      return Effect.gen(function* () {
        const client = yield* makeClient;
        yield* client.token.grant({
          payload: {
            grant_type: "refresh_token",
            refresh_token: refreshToken("refresh-token"),
            client_id: "website",
          },
        });
        const request = provider.requests[0];
        assert.isUndefined(request?.headers["authorization"]);
        assert.deepStrictEqual(
          Object.fromEntries(new URLSearchParams(request?.body)),
          {
            grant_type: "refresh_token",
            refresh_token: "refresh-token",
            client_id: "website",
          },
        );
      }).pipe(Effect.provide(provider.layer));
    },
  );

  it.effect("surfaces token errors as typed errors by status", () => {
    const provider = fakeProvider((request) =>
      new URLSearchParams(request.body).get("client_secret") === "wrong"
        ? json(
            {
              error: "unauthorized_client",
              error_description: "Invalid client or Invalid client credentials",
            },
            401,
          )
        : json(
            { error: "invalid_grant", error_description: "Code not valid" },
            400,
          ),
    );
    return Effect.gen(function* () {
      const client = yield* makeClient;
      const badGrant = yield* client.token
        .grant({
          payload: {
            grant_type: "authorization_code",
            code: authorizationCode("expired"),
            redirect_uri: "https://unhalteproblem.de/auth/callback",
            code_verifier: codeVerifier("v".repeat(43)),
            client_id: "backend",
          },
        })
        .pipe(Effect.flip);
      assert.instanceOf(badGrant, OAuthBadRequest);
      assert.strictEqual(badGrant.error, "invalid_grant");

      const badClient = yield* client.token
        .grant({
          payload: {
            grant_type: "client_credentials",
            client_id: "backend",
            client_secret: clientSecret("wrong"),
          },
        })
        .pipe(Effect.flip);
      assert.instanceOf(badClient, OAuthUnauthorized);
      assert.strictEqual(badClient.error, "unauthorized_client");

      // The `_tag` is filled in while decoding, so catchTag works although
      // Keycloak's body has no discriminator.
      const recovered = yield* client.token
        .grant({
          payload: {
            grant_type: "client_credentials",
            client_id: "backend",
            client_secret: clientSecret("wrong"),
          },
        })
        .pipe(
          Effect.as("granted"),
          Effect.catchTag("OAuthUnauthorized", (e) => Effect.succeed(e.error)),
        );
      assert.strictEqual(recovered, "unauthorized_client");
    }).pipe(Effect.provide(provider.layer));
  });

  it.effect("revokes with an empty 200 response", () => {
    const provider = fakeProvider(() => new Response(null, { status: 200 }));
    return Effect.gen(function* () {
      const client = yield* makeClient;
      yield* client.token.revoke({
        payload: {
          token: refreshToken("refresh-token"),
          token_type_hint: "refresh_token",
          client_id: "website",
        },
      });
      assert.strictEqual(
        provider.requests[0]?.url,
        `${issuer}/protocol/openid-connect/revoke`,
      );
    }).pipe(Effect.provide(provider.layer));
  });

  it.effect("introspects active and inactive tokens", () => {
    const provider = fakeProvider((request) =>
      new URLSearchParams(request.body).get("token") === "active"
        ? json({
            active: true,
            sub: "user-1",
            scope: "openid email",
            client_id: "website",
            realm_access: { roles: ["admin"] },
          })
        : json({ active: false }),
    );
    return Effect.gen(function* () {
      const client = yield* makeClient;
      const active = yield* client.token.introspect({
        payload: { token: accessToken("active") },
      });
      assert.isTrue(active.active);
      assert.deepStrictEqual(active.scope, ["openid", "email"]);
      assert.deepStrictEqual(active["realm_access"], { roles: ["admin"] });

      const inactive = yield* client.token.introspect({
        payload: { token: accessToken("revoked") },
      });
      assert.deepStrictEqual(inactive, { active: false });
    }).pipe(Effect.provide(provider.layer));
  });

  it.effect("fetches userinfo with the bearer token, as JSON or JWT", () => {
    const claims = {
      sub: "user-1",
      email: "ada@example.org",
      email_verified: true,
    };
    const provider = fakeProvider((request) =>
      request.headers["authorization"] === "Bearer signed"
        ? new Response(
            jwt({ alg: "RS256", kid: "a" }, { ...claims, iss: issuer }),
            {
              headers: { "content-type": "application/jwt" },
            },
          )
        : request.headers["authorization"] === "Bearer expired"
          ? json(
              {
                error: "invalid_token",
                error_description: "Token verification failed",
              },
              401,
            )
          : json(claims),
    );
    return Effect.gen(function* () {
      const client = yield* makeClient;
      const plain = yield* client.userinfo.get({
        headers: { authorization: accessToken("plain") },
      });
      assert.deepStrictEqual(plain, claims);

      const signed = yield* client.userinfo.get({
        headers: { authorization: accessToken("signed") },
      });
      // UserInfo keeps unknown claims, so `"signingInput" in signed` does not
      // narrow the union; check against the decoded JWT shape instead.
      assert.isTrue(Schema.is(SignedUserInfo)(signed));
      if (Schema.is(SignedUserInfo)(signed)) {
        assert.strictEqual(signed.payload.sub, "user-1");
        assert.strictEqual(signed.payload["iss"], issuer);
        assert.strictEqual(signed.header.kid, "a");
      }

      const error = yield* client.userinfo
        .get({ headers: { authorization: accessToken("expired") } })
        .pipe(Effect.flip);
      assert.instanceOf(error, OAuthUnauthorized);
    }).pipe(Effect.provide(provider.layer));
  });
});
