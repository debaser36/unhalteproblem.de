import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import { BackchannelLogoutEvent, LogoutTokenClaims } from "./Logout.ts";

const decode = Schema.decodeUnknownExit(LogoutTokenClaims);

const claims = {
  iss: "https://auth.example.org/realms/unhalteproblem",
  aud: "backend",
  iat: 1_800_000_000,
  exp: 1_800_000_120,
  jti: "jti-1",
  sid: "session-1",
  events: { [BackchannelLogoutEvent]: {} },
};

describe("LogoutTokenClaims", () => {
  it("accepts a token naming the session", () => {
    assert.isTrue(Exit.isSuccess(decode(claims)));
  });

  it("accepts a token naming only the user", () => {
    const { sid: _, ...withoutSid } = claims;
    assert.isTrue(Exit.isSuccess(decode({ ...withoutSid, sub: "user-1" })));
  });

  it.each([
    ["neither sub nor sid", { sid: undefined }],
    ["a nonce, as in an ID token", { nonce: "n" }],
    ["no logout event", { events: {} }],
    ["no jti", { jti: undefined }],
  ])("rejects %s", (_, patch) => {
    const input = Object.fromEntries(
      Object.entries({ ...claims, ...patch }).filter(
        ([, v]) => v !== undefined,
      ),
    );
    assert.isTrue(Exit.isFailure(decode(input)));
  });
});
