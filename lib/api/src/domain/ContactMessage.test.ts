import { assert, describe, it } from "@effect/vitest";
import { DateTime, Exit, Schema } from "effect";
import {
  ContactMessage,
  ContactMessageCursor,
  ContactMessageCursorMaxLength,
  ContactMessageId,
  ContactMessageLimits,
  ContactMessagePage,
  ContactMessagePageLimits,
  ContactMessagePageQuery,
  ReceivedContactMessage,
} from "./ContactMessage.ts";

const decode = Schema.decodeUnknownExit(ContactMessage);

const valid = {
  name: "Ada Lovelace",
  email: "ada@example.org",
  message: "Hello there!",
};

describe("ContactMessage", () => {
  it("accepts a valid message", () => {
    const exit = decode(valid);
    assert.isTrue(Exit.isSuccess(exit));
    if (Exit.isSuccess(exit)) assert.deepStrictEqual(exit.value, valid);
  });

  it("accepts limits exactly", () => {
    const atLimit = {
      name: "n".repeat(ContactMessageLimits.nameMaxLength),
      email: `${"a".repeat(ContactMessageLimits.emailMaxLength - "@example.org".length)}@example.org`,
      message: "m".repeat(ContactMessageLimits.messageMaxLength),
    };
    assert.isTrue(Exit.isSuccess(decode(atLimit)));
  });

  it("still accepts newlines, tabs and other control characters", () => {
    const message = "line 1\nline 2\t\u0001 \u{1F600}";
    assert.isTrue(Exit.isSuccess(decode({ ...valid, message })));
  });

  it("rejects NUL in the encoded direction too", () => {
    const encode = Schema.encodeUnknownExit(ContactMessage);
    assert.isTrue(Exit.isFailure(encode({ ...valid, name: "A\u0000" })));
  });

  it.each([
    ["no @", "ada.example.org"],
    ["no domain dot", "ada@example"],
    ["empty domain label", "ada@example..org"],
    ["whitespace inside", "ada lovelace@example.org"],
    ["two @", "ada@lovelace@example.org"],
    ["empty", ""],
  ])("rejects a bad email (%s)", (_, email) => {
    assert.isTrue(Exit.isFailure(decode({ ...valid, email })));
  });

  it.each([
    ["empty message", { message: "" }],
    ["whitespace-only message", { message: "   " }],
    ["untrimmed message", { message: " hi " }],
    [
      "message too long",
      { message: "m".repeat(ContactMessageLimits.messageMaxLength + 1) },
    ],
    ["empty name", { name: "" }],
    ["untrimmed name", { name: "Ada " }],
    [
      "name too long",
      { name: "n".repeat(ContactMessageLimits.nameMaxLength + 1) },
    ],
    [
      "email too long",
      {
        email: `${"a".repeat(ContactMessageLimits.emailMaxLength)}@example.org`,
      },
    ],
    ["NUL in name", { name: "Ada\u0000Lovelace" }],
    ["NUL in email", { email: "ada\u0000@example.org" }],
    ["NUL in message", { message: "Hello\u0000there" }],
    ["missing field", { message: undefined }],
  ])("rejects %s", (_, patch) => {
    assert.isTrue(Exit.isFailure(decode({ ...valid, ...patch })));
  });
});

const messageId = "6a1f3c2e-8b4d-4e5f-9a6b-7c8d9e0f1a2b";

const base64Url = (text: string) =>
  btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

const received: typeof ReceivedContactMessage.Encoded = {
  ...valid,
  id: messageId,
  createdAt: "2026-03-01T12:00:00.000Z",
};

describe("ReceivedContactMessage", () => {
  const decode = Schema.decodeUnknownExit(ReceivedContactMessage);

  it("round-trips a stored message", () => {
    const decoded = Schema.decodeUnknownSync(ReceivedContactMessage)(received);
    assert.deepStrictEqual(
      Schema.encodeSync(ReceivedContactMessage)(decoded),
      received,
    );
  });

  it("requires a UUID id and the form's rules", () => {
    assert.isTrue(Exit.isFailure(decode({ ...received, id: "1" })));
    assert.isTrue(Exit.isFailure(decode({ ...received, createdAt: "now" })));
    assert.isTrue(Exit.isFailure(decode({ ...received, name: "" })));
  });
});

describe("ContactMessageCursor", () => {
  const decode = Schema.decodeUnknownExit(ContactMessageCursor);
  const position = {
    createdAt: DateTime.makeUnsafe("2026-03-01T12:00:00.123Z"),
    id: ContactMessageId.make(messageId),
  };

  it("round-trips the base64url JSON pair", () => {
    const encoded = Schema.encodeSync(ContactMessageCursor)(position);
    assert.strictEqual(
      encoded,
      base64Url(JSON.stringify([1772366400123, messageId])),
    );
    assert.isAtMost(encoded.length, ContactMessageCursorMaxLength);
    assert.deepStrictEqual(
      Schema.decodeSync(ContactMessageCursor)(encoded),
      position,
    );
  });

  it("rejects malformed cursors", () => {
    const pair = (a: unknown, b: unknown) => base64Url(JSON.stringify([a, b]));
    for (const bad of [
      "",
      "not*base64url",
      base64Url("{}"),
      pair("1772366400123", messageId),
      pair(1.5, messageId),
      pair(1772366400123, "not-a-uuid"),
      "A".repeat(ContactMessageCursorMaxLength + 1),
    ]) {
      assert.isTrue(Exit.isFailure(decode(bad)), bad);
    }
  });
});

describe("ContactMessagePageQuery and ContactMessagePage", () => {
  const decode = Schema.decodeUnknownExit(ContactMessagePageQuery);

  it("fills in the default limit and bounds it", () => {
    assert.deepStrictEqual(
      decode({}),
      Exit.succeed({ limit: ContactMessagePageLimits.defaultLimit }),
    );
    assert.isTrue(
      Exit.isSuccess(decode({ limit: ContactMessagePageLimits.maxLimit })),
    );
    for (const limit of [0, ContactMessagePageLimits.maxLimit + 1, 1.5]) {
      assert.isTrue(Exit.isFailure(decode({ limit })), String(limit));
    }
  });

  it("round-trips a page with and without a next cursor", () => {
    const cursor = base64Url(JSON.stringify([1772366400000, messageId]));
    for (const nextCursor of [cursor, null]) {
      const page = { messages: [received], nextCursor };
      const decoded = Schema.decodeUnknownSync(ContactMessagePage)(page);
      assert.deepStrictEqual(
        Schema.encodeSync(ContactMessagePage)(decoded),
        page,
      );
    }
  });
});
