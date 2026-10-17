import { assert, describe, it } from "@effect/vitest";
import {
  BackchannelLogoutEvent,
  IdToken,
  LogoutToken,
} from "@unhalteproblem.de/oidc";
import { Effect, Schema } from "effect";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  SignJWT,
} from "jose";
import { InvalidToken, TokenVerifier } from "./TokenVerifier.ts";

const issuer = "https://auth.example.org/realms/test";
const clientId = "backend";

// A signing key for the "provider" and one it never published.
const providerKey = await generateKeyPair("RS256", { extractable: true });
const foreignKey = await generateKeyPair("RS256");
const providerJwk = {
  ...(await exportJWK(providerKey.publicKey)),
  kid: "k1",
  alg: "RS256",
  use: "sig",
};

const layer = TokenVerifier.layerWith({
  issuer,
  clientId,
  keys: createLocalJWKSet({ keys: [providerJwk] }),
});

const now = () => Math.floor(Date.now() / 1000);

const without = <T extends object, K extends keyof T>(value: T, key: K) => {
  const { [key]: _, ...rest } = value;
  return rest;
};

const sign = (
  payload: JWTPayload,
  options: {
    readonly key?: CryptoKey;
    readonly alg?: string;
    readonly typ?: string;
  } = {},
) =>
  new SignJWT(payload)
    .setProtectedHeader({
      alg: options.alg ?? "RS256",
      kid: "k1",
      typ: options.typ ?? "JWT",
    })
    .sign(options.key ?? providerKey.privateKey);

const idTokenClaims = () => ({
  iss: issuer,
  sub: "user-1",
  aud: clientId,
  iat: now(),
  exp: now() + 300,
  nonce: "nonce-1",
  sid: "kc-session-1",
  email: "ada@example.org",
});

const verifyId = (payload: JWTPayload, nonce = "nonce-1") =>
  Effect.gen(function* () {
    const verifier = yield* TokenVerifier;
    const raw = yield* Effect.promise(() => sign(payload));
    const token = yield* Schema.decodeEffect(IdToken)(raw);
    return yield* verifier.verifyIdToken(token, { nonce });
  });

describe("TokenVerifier.verifyIdToken", () => {
  it.effect("accepts a valid ID token and returns its claims", () =>
    Effect.gen(function* () {
      const claims = yield* verifyId(idTokenClaims());
      assert.strictEqual(claims.sub, "user-1");
      assert.deepStrictEqual(claims.aud, [clientId]);
      assert.strictEqual(claims.sid, "kc-session-1");
      assert.strictEqual(claims.email, "ada@example.org");
    }).pipe(Effect.provide(layer)),
  );

  it.effect.each<readonly [string, JWTPayload]>([
    ["another issuer", { ...idTokenClaims(), iss: "https://evil.example/x" }],
    ["another audience", { ...idTokenClaims(), aud: "other-client" }],
    [
      "an expired token",
      { ...idTokenClaims(), iat: now() - 900, exp: now() - 600 },
    ],
    ["a token issued too long ago", { ...idTokenClaims(), iat: now() - 3600 }],
    ["a foreign azp", { ...idTokenClaims(), aud: [clientId, "x"], azp: "x" }],
    [
      "multiple audiences without azp",
      { ...idTokenClaims(), aud: [clientId, "x"] },
    ],
    ["no subject", without(idTokenClaims(), "sub")],
  ])("rejects %s", ([, payload]) =>
    Effect.gen(function* () {
      const error = yield* verifyId(payload).pipe(Effect.flip);
      assert.instanceOf(error, InvalidToken);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects a nonce from another login", () =>
    Effect.gen(function* () {
      const error = yield* verifyId(idTokenClaims(), "nonce-2").pipe(
        Effect.flip,
      );
      assert.instanceOf(error, InvalidToken);
      if (error instanceof InvalidToken) {
        assert.strictEqual(error.reason, "nonce mismatch");
      }
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects a token signed with an unpublished key", () =>
    Effect.gen(function* () {
      const verifier = yield* TokenVerifier;
      const raw = yield* Effect.promise(() =>
        sign(idTokenClaims(), { key: foreignKey.privateKey }),
      );
      const error = yield* verifier
        .verifyIdToken(yield* Schema.decodeEffect(IdToken)(raw), {
          nonce: "nonce-1",
        })
        .pipe(Effect.flip);
      assert.include(error.reason, "SIGNATURE");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects HS256 signed with the public key (alg confusion)", () =>
    Effect.gen(function* () {
      const verifier = yield* TokenVerifier;
      const secret = new TextEncoder().encode(JSON.stringify(providerJwk));
      const raw = yield* Effect.promise(() =>
        new SignJWT(idTokenClaims())
          .setProtectedHeader({ alg: "HS256", kid: "k1" })
          .sign(secret),
      );
      const error = yield* verifier
        .verifyIdToken(yield* Schema.decodeEffect(IdToken)(raw), {
          nonce: "nonce-1",
        })
        .pipe(Effect.flip);
      assert.instanceOf(error, InvalidToken);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects an unsigned token (alg none)", () =>
    Effect.gen(function* () {
      const verifier = yield* TokenVerifier;
      const encode = (value: object) =>
        Buffer.from(JSON.stringify(value)).toString("base64url");
      const raw = `${encode({ alg: "none", kid: "k1" })}.${encode(idTokenClaims())}.`;
      const error = yield* verifier
        .verifyIdToken(yield* Schema.decodeEffect(IdToken)(raw), {
          nonce: "nonce-1",
        })
        .pipe(Effect.flip);
      assert.instanceOf(error, InvalidToken);
    }).pipe(Effect.provide(layer)),
  );
});

const logoutClaims = () => ({
  iss: issuer,
  aud: clientId,
  iat: now(),
  exp: now() + 120,
  jti: "jti-1",
  sid: "kc-session-1",
  events: { [BackchannelLogoutEvent]: {} },
});

const verifyLogout = (payload: JWTPayload) =>
  Effect.gen(function* () {
    const verifier = yield* TokenVerifier;
    const raw = yield* Effect.promise(() =>
      sign(payload, { typ: "logout+jwt" }),
    );
    return yield* verifier.verifyLogoutToken(
      yield* Schema.decodeEffect(LogoutToken)(raw),
    );
  });

describe("TokenVerifier.verifyLogoutToken", () => {
  it.effect("accepts a valid logout token", () =>
    Effect.gen(function* () {
      const claims = yield* verifyLogout(logoutClaims());
      assert.strictEqual(claims.sid, "kc-session-1");
      assert.strictEqual(claims.jti, "jti-1");
    }).pipe(Effect.provide(layer)),
  );

  it.effect.each<readonly [string, JWTPayload]>([
    ["an ID token (nonce, no events)", idTokenClaims()],
    ["a token with a nonce", { ...logoutClaims(), nonce: "n" }],
    ["a token without the logout event", { ...logoutClaims(), events: {} }],
    ["a token for another client", { ...logoutClaims(), aud: "other" }],
    ["a token naming neither sub nor sid", without(logoutClaims(), "sid")],
  ])("rejects %s", ([, payload]) =>
    Effect.gen(function* () {
      const error = yield* verifyLogout(payload).pipe(Effect.flip);
      assert.instanceOf(error, InvalidToken);
    }).pipe(Effect.provide(layer)),
  );
});
