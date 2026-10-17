import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import { UnverifiedIdToken } from "./Claims.ts";
import { JsonWebKeySet, PublicJsonWebKey } from "./Jose.ts";

const base64url = (value: string) =>
  btoa(value).replace(/=+$/u, "").replace(/\+/gu, "-").replace(/\//gu, "_");

const header = { alg: "RS256", typ: "JWT", kid: "key-1" };
const claims = {
  iss: "https://auth.example.org/realms/unhalteproblem",
  sub: "f1b2c3d4",
  aud: "website",
  exp: 1_800_000_000,
  iat: 1_799_999_700,
  nonce: "nonce-1",
  email: "ada@example.org",
  realm_access: { roles: ["admin"] },
};
const encodedHeader = base64url(JSON.stringify(header));
const encodedPayload = base64url(JSON.stringify(claims));
const token = `${encodedHeader}.${encodedPayload}.AQID`;

const decodeIdToken = Schema.decodeUnknownExit(UnverifiedIdToken);

describe("Jwt", () => {
  it("decodes header, claims and signature without verifying", () => {
    const exit = decodeIdToken(token);
    assert.isTrue(Exit.isSuccess(exit));
    if (Exit.isFailure(exit)) return;
    const jwt = exit.value;
    assert.strictEqual(jwt.header.kid, "key-1");
    assert.strictEqual(jwt.payload.sub, "f1b2c3d4");
    // A single audience is normalised into an array.
    assert.deepStrictEqual(jwt.payload.aud, ["website"]);
    // Provider-specific claims are kept for authorization.
    assert.deepStrictEqual(jwt.payload["realm_access"], { roles: ["admin"] });
    assert.strictEqual(jwt.signingInput, `${encodedHeader}.${encodedPayload}`);
    assert.deepStrictEqual(jwt.signature, new Uint8Array([1, 2, 3]));
  });

  it("encodes back to the original token", () => {
    const exit = decodeIdToken(token);
    if (Exit.isFailure(exit)) return assert.fail("decoding failed");
    assert.strictEqual(Schema.encodeSync(UnverifiedIdToken)(exit.value), token);
  });

  it.each([
    ["two parts", `${encodedHeader}.${encodedPayload}`],
    ["an encrypted JWT", `${encodedHeader}.a.b.c.d`],
    ["a non-JSON payload", `${encodedHeader}.${base64url("nope")}.AQID`],
    ["invalid base64url", `${encodedHeader}.***.AQID`],
    ["a header without alg", `${base64url("{}")}.${encodedPayload}.AQID`],
    [
      "claims without sub",
      `${encodedHeader}.${base64url(JSON.stringify({ ...claims, sub: undefined }))}.AQID`,
    ],
  ])("rejects %s", (_, input) => {
    assert.isTrue(Exit.isFailure(decodeIdToken(input)));
  });
});

describe("JSON Web Keys", () => {
  const rsa = {
    kty: "RSA",
    kid: "a",
    use: "sig",
    alg: "RS256",
    n: "sXch",
    e: "AQAB",
  };

  it("decodes a usable public key by type", () => {
    const exit = Schema.decodeUnknownExit(PublicJsonWebKey)(rsa);
    assert.isTrue(Exit.isSuccess(exit));
    if (Exit.isSuccess(exit)) assert.strictEqual(exit.value.kty, "RSA");
  });

  it("rejects incomplete or symmetric keys as public keys", () => {
    const decode = Schema.decodeUnknownExit(PublicJsonWebKey);
    assert.isTrue(Exit.isFailure(decode({ ...rsa, n: undefined })));
    assert.isTrue(Exit.isFailure(decode({ kty: "oct", k: "c2VjcmV0" })));
  });

  it("keeps the whole set decodable around incomplete keys", () => {
    const exit = Schema.decodeExit(JsonWebKeySet)({
      keys: [rsa, { kty: "EC", kid: "b" }],
    });
    assert.isTrue(Exit.isSuccess(exit));
  });
});
