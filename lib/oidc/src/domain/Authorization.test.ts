import { assert, describe, it } from "@effect/vitest";
import { Exit, Redacted, Schema } from "effect";
import { AuthorizationCallback } from "./Authorization.ts";

const decode = Schema.decodeUnknownExit(AuthorizationCallback);

describe("AuthorizationCallback", () => {
  it("decodes a successful redirect with a redacted code", () => {
    const exit = decode({
      code: "the-code",
      state: "state-1",
      iss: "https://auth.example.org/realms/unhalteproblem",
      session_state: "s",
    });
    assert.isTrue(Exit.isSuccess(exit));
    if (Exit.isSuccess(exit) && "code" in exit.value) {
      assert.strictEqual(Redacted.value(exit.value.code), "the-code");
    }
  });

  it("decodes an error redirect", () => {
    const exit = decode({ error: "access_denied", state: "state-1" });
    assert.isTrue(Exit.isSuccess(exit));
    if (Exit.isSuccess(exit)) assert.property(exit.value, "error");
  });

  it("treats a redirect with both error and code as an error", () => {
    const exit = decode({ error: "server_error", code: "c", state: "s" });
    assert.isTrue(Exit.isSuccess(exit));
    if (Exit.isSuccess(exit)) assert.notProperty(exit.value, "code");
  });

  it("rejects a redirect without state", () => {
    assert.isTrue(Exit.isFailure(decode({ code: "the-code" })));
  });
});
