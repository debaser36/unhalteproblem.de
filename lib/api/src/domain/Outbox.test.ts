import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import {
  OutboxLimits,
  OutboxMessage,
  OutboxMessageId,
  OutboxQuery,
} from "./Outbox.ts";

const pending: typeof OutboxMessage.Encoded = {
  id: 7,
  topic: "contact.send-mail",
  attempts: 0,
  lastError: null,
  availableAt: "2026-03-01T12:00:00.000Z",
  lockedUntil: null,
  deadAt: null,
  createdAt: "2026-03-01T12:00:00.000Z",
};

const dead: typeof OutboxMessage.Encoded = {
  ...pending,
  attempts: 10,
  lastError: "MailFailed:EAUTH:535:AUTH PLAIN",
  lockedUntil: "2026-03-01T13:05:00.000Z",
  deadAt: "2026-03-01T13:00:00.000Z",
};

describe("OutboxMessageId", () => {
  const decode = Schema.decodeUnknownExit(OutboxMessageId);

  it("is a positive safe integer", () => {
    assert.isTrue(Exit.isSuccess(decode(1)));
    for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "7", null]) {
      assert.isTrue(Exit.isFailure(decode(bad)), String(bad));
    }
  });
});

describe("OutboxMessage", () => {
  const decode = Schema.decodeUnknownExit(OutboxMessage);

  it("round-trips a pending and a dead message", () => {
    for (const encoded of [pending, dead]) {
      const decoded = Schema.decodeUnknownSync(OutboxMessage)(encoded);
      assert.deepStrictEqual(
        Schema.encodeSync(OutboxMessage)(decoded),
        encoded,
      );
    }
  });

  it("has no payload and requires the nullable fields", () => {
    const decoded = Schema.decodeUnknownSync(OutboxMessage)({
      ...pending,
      payload: { messageId: "x" },
    });
    assert.notProperty(decoded, "payload");
    assert.isTrue(Exit.isFailure(decode({ ...pending, deadAt: undefined })));
    assert.isTrue(Exit.isFailure(decode({ ...pending, attempts: -1 })));
  });
});

describe("OutboxQuery", () => {
  const decode = Schema.decodeUnknownExit(OutboxQuery);

  it("defaults to all messages, at most 100", () => {
    assert.deepStrictEqual(
      decode({}),
      Exit.succeed({ state: "all" as const, limit: OutboxLimits.defaultLimit }),
    );
  });

  it("accepts the states and the bounds", () => {
    for (const state of ["pending", "dead", "all"] as const) {
      assert.deepStrictEqual(
        decode({ state, limit: 1 }),
        Exit.succeed({ state, limit: 1 }),
      );
    }
    assert.isTrue(Exit.isSuccess(decode({ limit: OutboxLimits.maxLimit })));
  });

  it("rejects other states and limits", () => {
    for (const bad of [
      { state: "locked" },
      { limit: 0 },
      { limit: OutboxLimits.maxLimit + 1 },
      { limit: 2.5 },
    ]) {
      assert.isTrue(Exit.isFailure(decode(bad)), JSON.stringify(bad));
    }
  });
});
