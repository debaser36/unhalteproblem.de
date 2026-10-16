import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import { ContactMessage, ContactMessageLimits } from "./ContactMessage.ts";

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
    ["missing field", { message: undefined }],
  ])("rejects %s", (_, patch) => {
    assert.isTrue(Exit.isFailure(decode({ ...valid, ...patch })));
  });
});
