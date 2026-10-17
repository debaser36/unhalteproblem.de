import { assert, describe, it } from "@effect/vitest";
import { Exit, Redacted, Schema } from "effect";
import { AccessToken, BearerAuthorization } from "./Credentials.ts";

describe("BearerAuthorization", () => {
  it("decodes the token, matching the scheme case-insensitively", () => {
    const token = Schema.decodeSync(BearerAuthorization)("bearer abc.def");
    assert.strictEqual(Redacted.value(token), "abc.def");
  });

  it("encodes with the Bearer scheme", () => {
    const token = Schema.decodeSync(AccessToken)("abc");
    assert.strictEqual(
      Schema.encodeSync(BearerAuthorization)(token),
      "Bearer abc",
    );
  });

  it.each(["Basic abc", "Bearer", "abc"])("rejects %j", (header) => {
    assert.isTrue(
      Exit.isFailure(Schema.decodeExit(BearerAuthorization)(header)),
    );
  });
});

describe("credentials", () => {
  it("are redacted when printed", () => {
    const token = Schema.decodeSync(AccessToken)("secret-token");
    assert.notInclude(String(token), "secret-token");
    assert.notInclude(JSON.stringify({ token }), "secret-token");
  });
});
