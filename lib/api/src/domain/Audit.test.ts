import { assert, describe, it } from "@effect/vitest";
import { Exit, Schema } from "effect";
import { UserId } from "#domain/Admin";
import {
  AuditAction,
  AuditCursor,
  AuditCursorMaxLength,
  AuditDetailMaxLength,
  AuditLogEntry,
  AuditLogEntryId,
  AuditLogLimits,
  AuditLogPage,
  AuditLogQuery,
} from "./Audit.ts";

const adaId = "3f0c6a8e-2b1d-4c5e-9f7a-1b2c3d4e5f60";

const base64Url = (text: string) =>
  btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

const entry: typeof AuditLogEntry.Encoded = {
  id: 42,
  at: "2026-03-01T12:00:00.000Z",
  action: "role_granted",
  actorId: adaId,
  targetId: adaId,
  detail: "admin",
};

describe("AuditAction", () => {
  it("lists every action the backend writes", () => {
    assert.deepStrictEqual(AuditAction.literals, [
      "login",
      "logout",
      "login_refused",
      "role_granted",
      "role_revoked",
      "user_restricted",
      "restriction_lifted",
      "account_deleted",
      "outbox_retried",
      "contact_message_deleted",
      "blog_created",
      "blog_updated",
      "post_deleted",
      "project_created",
      "project_updated",
      "project_deleted",
    ]);
  });
});

describe("AuditLogEntryId", () => {
  const decode = Schema.decodeUnknownExit(AuditLogEntryId);

  it("is a positive safe integer", () => {
    assert.isTrue(Exit.isSuccess(decode(1)));
    assert.isTrue(Exit.isSuccess(decode(Number.MAX_SAFE_INTEGER)));
    for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
      assert.isTrue(Exit.isFailure(decode(bad)), String(bad));
    }
  });
});

describe("AuditLogEntry", () => {
  const decode = Schema.decodeUnknownExit(AuditLogEntry);

  it("round-trips, with and without actor, target and detail", () => {
    const system = {
      ...entry,
      action: "contact_message_deleted",
      actorId: null,
      targetId: null,
      detail: null,
    };
    for (const encoded of [entry, system]) {
      const decoded = Schema.decodeUnknownSync(AuditLogEntry)(encoded);
      assert.deepStrictEqual(
        Schema.encodeSync(AuditLogEntry)(decoded),
        encoded,
      );
    }
  });

  it("requires every key and bounds the detail like the database", () => {
    assert.isTrue(Exit.isFailure(decode({ ...entry, detail: undefined })));
    assert.isTrue(Exit.isFailure(decode({ ...entry, detail: "" })));
    assert.isTrue(
      Exit.isSuccess(
        decode({ ...entry, detail: "d".repeat(AuditDetailMaxLength) }),
      ),
    );
    assert.isTrue(
      Exit.isFailure(
        decode({ ...entry, detail: "d".repeat(AuditDetailMaxLength + 1) }),
      ),
    );
    assert.isTrue(Exit.isFailure(decode({ ...entry, action: "logged_in" })));
    assert.isTrue(Exit.isFailure(decode({ ...entry, actorId: "f1b2c3d4" })));
  });
});

describe("AuditCursor", () => {
  const decode = Schema.decodeUnknownExit(AuditCursor);
  const encoded = base64Url("[42]");

  it("decodes the base64url JSON array into the id and round-trips", () => {
    const cursor = Schema.decodeSync(AuditCursor)(encoded);
    assert.deepStrictEqual(cursor, { id: AuditLogEntryId.make(42) });
    assert.strictEqual(Schema.encodeSync(AuditCursor)(cursor), encoded);
    const largest = Schema.encodeSync(AuditCursor)({
      id: AuditLogEntryId.make(Number.MAX_SAFE_INTEGER),
    });
    assert.match(largest, /^[A-Za-z0-9_-]+$/);
    assert.isAtMost(largest.length, AuditCursorMaxLength);
  });

  it("rejects malformed and tampered cursors", () => {
    for (const bad of [
      "",
      "not*base64url",
      base64Url("not json"),
      base64Url("42"),
      base64Url("{}"),
      base64Url("[]"),
      base64Url("[0]"),
      base64Url("[1.5]"),
      base64Url('["42"]'),
      base64Url("[42,43]"),
      base64Url(`[${" ".repeat(AuditCursorMaxLength)}42]`),
      "A".repeat(AuditCursorMaxLength + 1),
    ]) {
      assert.isTrue(Exit.isFailure(decode(bad)), bad);
    }
  });
});

describe("AuditLogQuery", () => {
  const decode = Schema.decodeUnknownExit(AuditLogQuery);

  it("fills in the default limit and leaves the filters out", () => {
    assert.deepStrictEqual(
      decode({}),
      Exit.succeed({ limit: AuditLogLimits.defaultLimit }),
    );
  });

  it("decodes the cursor and the filters", () => {
    assert.deepStrictEqual(
      decode({
        limit: 100,
        cursor: base64Url("[7]"),
        action: "outbox_retried",
        userId: adaId,
      }),
      Exit.succeed({
        limit: 100,
        cursor: { id: AuditLogEntryId.make(7) },
        action: "outbox_retried" as const,
        userId: UserId.make(adaId),
      }),
    );
  });

  it("bounds the limit and validates the filters", () => {
    for (const bad of [
      { limit: 0 },
      { limit: AuditLogLimits.maxLimit + 1 },
      { limit: 1.5 },
      { action: "unknown" },
      { userId: "f1b2c3d4" },
      { cursor: "*" },
    ]) {
      assert.isTrue(Exit.isFailure(decode(bad)), JSON.stringify(bad));
    }
  });
});

describe("AuditLogPage", () => {
  it("round-trips a page with and without a next cursor", () => {
    for (const nextCursor of [base64Url("[42]"), null]) {
      const page = { entries: [entry], nextCursor };
      const decoded = Schema.decodeUnknownSync(AuditLogPage)(page);
      assert.deepStrictEqual(Schema.encodeSync(AuditLogPage)(decoded), page);
    }
  });
});
