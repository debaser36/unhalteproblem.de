import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import { Scopes } from "./Primitives.ts";

describe("Scopes", () => {
  it("decodes a space-delimited list, tolerating extra spaces", () => {
    assert.deepStrictEqual(Schema.decodeSync(Scopes)(" openid  email "), [
      "openid",
      "email",
    ]);
  });

  it("encodes with single spaces", () => {
    assert.strictEqual(
      Schema.encodeSync(Scopes)(["openid", "email"]),
      "openid email",
    );
  });

  it("rejects characters outside scope-token", () => {
    assert.isTrue(Exit.isFailure(Schema.decodeExit(Scopes)('openid "x"')));
  });
});
