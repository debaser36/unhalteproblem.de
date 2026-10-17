import { Effect } from "effect";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A fresh random value: 32 bytes (256 bits) from the OS CSPRNG, base64url
 * without padding (43 characters). Used for session and login cookies,
 * `state`, `nonce` and the PKCE verifier, which RFC 7636 §7.1 wants with at
 * least 256 bits of entropy.
 */
export const randomSecret = Effect.sync(() =>
  randomBytes(32).toString("base64url"),
);

/**
 * SHA-256 of a cookie value. Only the hash is stored, so a leaked database
 * does not contain usable session cookies.
 */
export const hashSecret = (value: string): Uint8Array =>
  new Uint8Array(createHash("sha256").update(value, "utf8").digest());

/** PKCE `S256` challenge for a verifier (RFC 7636 §4.2). */
export const pkceChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier, "ascii").digest("base64url");

/** Compares two secrets without leaking their common prefix through timing. */
export const secretsEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};
