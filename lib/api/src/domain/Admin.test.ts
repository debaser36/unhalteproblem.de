import { assert, describe, it } from "@effect/vitest";
import { DateTime, Exit, Schema } from "effect";
import {
  AdminUser,
  AdminUserDetails,
  LiftRestrictionPayload,
  RestrictPayload,
  Restriction,
  RestrictionNote,
  RestrictionNoteMaxLength,
  RoleChange,
  UserCursor,
  UserCursorMaxLength,
  UserId,
  UserPage,
  UserPageLimits,
  UserPageQuery,
} from "./Admin.ts";

const adaId = "3f0c6a8e-2b1d-4c5e-9f7a-1b2c3d4e5f60";
const graceId = "8d7e6f5a-4b3c-4d2e-8f1a-0b9c8d7e6f5a";
const restrictionId = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f";

const activeRestriction: typeof Restriction.Encoded = {
  id: restrictionId,
  note: "Spam in the comments.",
  restrictedBy: graceId,
  restrictedAt: "2026-02-01T10:00:00.000Z",
  liftedAt: null,
  liftedBy: null,
  liftNote: null,
};

const liftedRestriction: typeof Restriction.Encoded = {
  ...activeRestriction,
  liftedAt: "2026-02-02T10:00:00.000Z",
  liftedBy: graceId,
  liftNote: "Apologised.",
};

const adminUser: typeof AdminUser.Encoded = {
  id: adaId,
  subject: "f1b2c3d4",
  username: "ada",
  name: null,
  email: "ada@example.org",
  emailVerified: true,
  createdAt: "2026-01-01T12:00:00.000Z",
  updatedAt: "2026-01-02T12:00:00.000Z",
  lastLoginAt: "2026-01-03T12:00:00.000Z",
  deletedAt: null,
  roles: ["normalUser"],
  restriction: activeRestriction,
};

describe("UserId", () => {
  const decode = Schema.decodeUnknownExit(UserId);

  it("accepts UUIDs", () => {
    assert.deepStrictEqual(decode(adaId), Exit.succeed(UserId.make(adaId)));
    assert.isTrue(Exit.isSuccess(decode(adaId.toUpperCase())));
  });

  it.each([
    ["an OIDC subject", "f1b2c3d4"],
    ["a UUID without dashes", adaId.replaceAll("-", "")],
    ["a UUID with braces", `{${adaId}}`],
    ["the empty string", ""],
    ["a number", 42],
  ])("rejects %s", (_, value) => {
    assert.isTrue(Exit.isFailure(decode(value)));
  });
});

describe("RestrictionNote", () => {
  const decode = Schema.decodeUnknownExit(RestrictionNote);

  it.each([
    ["a single character", "x"],
    ["inner whitespace and newlines", "Spam.\n\nSee the report."],
    ["exactly the maximum length", "n".repeat(RestrictionNoteMaxLength)],
  ])("accepts %s", (_, note) => {
    assert.deepStrictEqual(decode(note), Exit.succeed(note));
  });

  it.each([
    ["the empty string", ""],
    ["only whitespace", "   "],
    ["leading whitespace", " note"],
    ["a trailing newline", "note\n"],
    ["one character too many", "n".repeat(RestrictionNoteMaxLength + 1)],
    ["null", null],
  ])("rejects %s", (_, note) => {
    assert.isTrue(Exit.isFailure(decode(note)));
  });
});

describe("RoleChange", () => {
  const change: typeof RoleChange.Encoded = {
    role: "admin",
    change: "granted",
    changedBy: graceId,
    changedAt: "2026-01-05T08:30:00.000Z",
  };

  it("round-trips, with and without an actor", () => {
    for (const encoded of [change, { ...change, changedBy: null }]) {
      const decoded = Schema.decodeSync(RoleChange)(encoded);
      assert.isTrue(DateTime.isDateTime(decoded.changedAt));
      assert.deepStrictEqual(Schema.encodeSync(RoleChange)(decoded), encoded);
    }
  });

  it("rejects unknown changes, roles and a missing actor key", () => {
    const decode = Schema.decodeUnknownExit(RoleChange);
    assert.isTrue(Exit.isFailure(decode({ ...change, change: "updated" })));
    assert.isTrue(Exit.isFailure(decode({ ...change, role: "root" })));
    const { changedBy: _, ...withoutActor } = change;
    assert.isTrue(Exit.isFailure(decode(withoutActor)));
  });
});

describe("Restriction", () => {
  it("round-trips an active and a lifted restriction", () => {
    for (const encoded of [activeRestriction, liftedRestriction]) {
      const decoded = Schema.decodeSync(Restriction)(encoded);
      assert.deepStrictEqual(Schema.encodeSync(Restriction)(decoded), encoded);
    }
    const lifted = Schema.decodeSync(Restriction)(liftedRestriction);
    assert.isNotNull(lifted.liftedAt);
  });

  it.each([
    ["a non-UUID id", { id: "r-1" }],
    ["an empty note", { note: "" }],
    ["an empty lift note", { liftNote: "" }],
    ["a non-UUID actor", { restrictedBy: "f1b2c3d4" }],
    ["an invalid date", { restrictedAt: "yesterday" }],
    ["undefined instead of null", { liftedAt: undefined }],
  ])("rejects %s", (_, patch) => {
    const decode = Schema.decodeUnknownExit(Restriction);
    assert.isTrue(Exit.isFailure(decode({ ...activeRestriction, ...patch })));
  });

  it("requires every key, even when null", () => {
    const decode = Schema.decodeUnknownExit(Restriction);
    const { liftNote: _, ...withoutLiftNote } = activeRestriction;
    assert.isTrue(Exit.isFailure(decode(withoutLiftNote)));
  });
});

describe("AdminUser", () => {
  it("round-trips with nulls, an active restriction and as a tombstone", () => {
    const unrestricted = {
      ...adminUser,
      username: null,
      email: null,
      restriction: null,
    };
    const tombstone = {
      ...adminUser,
      username: null,
      name: null,
      email: null,
      emailVerified: false,
      deletedAt: "2026-03-01T12:00:00.000Z",
      roles: [],
      restriction: null,
    };
    for (const encoded of [adminUser, unrestricted, tombstone]) {
      const decoded = Schema.decodeSync(AdminUser)(encoded);
      assert.deepStrictEqual(Schema.encodeSync(AdminUser)(decoded), encoded);
    }
  });

  it("requires the nullable fields to be present", () => {
    const decode = Schema.decodeUnknownExit(AdminUser);
    const { name: _, ...withoutName } = adminUser;
    assert.isTrue(Exit.isFailure(decode(withoutName)));
    const { restriction: __, ...withoutRestriction } = adminUser;
    assert.isTrue(Exit.isFailure(decode(withoutRestriction)));
    const { deletedAt: ___, ...withoutDeletedAt } = adminUser;
    assert.isTrue(Exit.isFailure(decode(withoutDeletedAt)));
  });

  it("rejects a malformed deletedAt", () => {
    const decode = Schema.decodeUnknownExit(AdminUser);
    assert.isTrue(Exit.isFailure(decode({ ...adminUser, deletedAt: "soon" })));
  });

  it("rejects an OIDC subject as id and an empty subject", () => {
    const decode = Schema.decodeUnknownExit(AdminUser);
    assert.isTrue(Exit.isFailure(decode({ ...adminUser, id: "f1b2c3d4" })));
    assert.isTrue(Exit.isFailure(decode({ ...adminUser, subject: "" })));
  });
});

describe("AdminUserDetails", () => {
  const details: typeof AdminUserDetails.Encoded = {
    ...adminUser,
    restrictions: [activeRestriction, liftedRestriction],
    roleChanges: [
      {
        role: "normalUser",
        change: "granted",
        changedBy: null,
        changedAt: "2026-01-01T12:00:00.000Z",
      },
    ],
  };

  it("round-trips the history", () => {
    const decoded = Schema.decodeSync(AdminUserDetails)(details);
    assert.strictEqual(decoded.restrictions.length, 2);
    assert.deepStrictEqual(
      Schema.encodeSync(AdminUserDetails)(decoded),
      details,
    );
  });

  it("requires the history fields", () => {
    const decode = Schema.decodeUnknownExit(AdminUserDetails);
    assert.isTrue(Exit.isFailure(decode(adminUser)));
  });
});

// The cursor of `adaId` created at 2026-01-01T12:00:00.000Z: base64url
// (no padding) of `[1767268800000,"3f0c6a8e-..."]`.
const adaCursorEncoded =
  "WzE3NjcyNjg4MDAwMDAsIjNmMGM2YThlLTJiMWQtNGM1ZS05ZjdhLTFiMmMzZDRlNWY2MCJd";

const base64Url = (text: string) =>
  btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

describe("UserCursor", () => {
  const decode = Schema.decodeUnknownExit(UserCursor);

  it("decodes the base64url JSON pair into createdAt and id", () => {
    const cursor = Schema.decodeSync(UserCursor)(adaCursorEncoded);
    assert.isTrue(DateTime.isUtc(cursor.createdAt));
    assert.strictEqual(
      DateTime.formatIso(cursor.createdAt),
      "2026-01-01T12:00:00.000Z",
    );
    assert.strictEqual(cursor.id, adaId);
    assert.deepStrictEqual(Object.keys(cursor).sort(), ["createdAt", "id"]);
  });

  it("round-trips in both directions", () => {
    const cursor = Schema.decodeSync(UserCursor)(adaCursorEncoded);
    assert.strictEqual(Schema.encodeSync(UserCursor)(cursor), adaCursorEncoded);
    const made = {
      createdAt: DateTime.makeUnsafe("2026-07-04T08:09:10.123Z"),
      id: UserId.make(graceId),
    };
    const encoded = Schema.encodeSync(UserCursor)(made);
    assert.match(encoded, /^[A-Za-z0-9_-]+$/);
    assert.isAtMost(encoded.length, UserCursorMaxLength);
    assert.deepStrictEqual(Schema.decodeSync(UserCursor)(encoded), made);
  });

  it("rejects malformed and tampered cursors", () => {
    const pair = (a: unknown, b: unknown) => base64Url(JSON.stringify([a, b]));
    for (const bad of [
      "",
      "not*base64url",
      adaCursorEncoded + "=",
      adaCursorEncoded.slice(0, -4),
      adaCursorEncoded.replace("W", "X"),
      base64Url("not json"),
      base64Url("{}"),
      base64Url(JSON.stringify([1767268800000])),
      base64Url(JSON.stringify([1767268800000, adaId, "extra"])),
      pair("1767268800000", adaId),
      pair(1.5, adaId),
      pair(1767268800000, "not-a-uuid"),
      pair(1767268800000, null),
      pair(null, adaId),
      "A".repeat(UserCursorMaxLength + 1),
    ]) {
      assert.isTrue(Exit.isFailure(decode(bad)), bad);
    }
    for (const bad of [null, 5, {}, undefined]) {
      assert.isTrue(Exit.isFailure(decode(bad)));
    }
  });

  it("bounds the encoded length", () => {
    // Padding the JSON with whitespace keeps it valid but too long.
    const padded = base64Url(
      `[1767268800000,${" ".repeat(UserCursorMaxLength)}"${adaId}"]`,
    );
    assert.isAbove(padded.length, UserCursorMaxLength);
    assert.isTrue(Exit.isFailure(decode(padded)));
  });
});

describe("UserPage", () => {
  it("round-trips a page with and without a next cursor", () => {
    for (const nextCursor of [adaCursorEncoded, null]) {
      const page = { users: [adminUser], nextCursor };
      const decoded = Schema.decodeSync(UserPage)(page);
      assert.deepStrictEqual(Schema.encodeSync(UserPage)(decoded), page);
    }
  });

  it("requires nextCursor and has no total", () => {
    const decode = Schema.decodeUnknownExit(UserPage);
    assert.isTrue(Exit.isFailure(decode({ users: [] })));
    assert.isTrue(Exit.isFailure(decode({ users: [], nextCursor: "x" })));
    const legacy = { users: [], nextCursor: null, total: 3 };
    const page = Schema.decodeSync(UserPage)(legacy);
    assert.deepStrictEqual(Object.keys(page).sort(), ["nextCursor", "users"]);
  });
});

describe("UserPageQuery", () => {
  const decode = Schema.decodeUnknownExit(UserPageQuery);
  const cursor = Schema.decodeSync(UserCursor)(adaCursorEncoded);

  it("fills in the default limit and leaves the cursor out", () => {
    assert.deepStrictEqual(
      decode({}),
      Exit.succeed({ limit: UserPageLimits.defaultLimit }),
    );
  });

  it("decodes the cursor", () => {
    assert.deepStrictEqual(
      decode({ cursor: adaCursorEncoded }),
      Exit.succeed({ limit: 50, cursor }),
    );
    assert.deepStrictEqual(
      Schema.encodeSync(UserPageQuery)({ limit: 5, cursor }),
      { limit: 5, cursor: adaCursorEncoded },
    );
  });

  it("accepts the bounds", () => {
    assert.deepStrictEqual(decode({ limit: 1 }), Exit.succeed({ limit: 1 }));
    assert.deepStrictEqual(
      decode({ limit: UserPageLimits.maxLimit }),
      Exit.succeed({ limit: 200 }),
    );
  });

  it("ignores the removed offset", () => {
    assert.deepStrictEqual(decode({ offset: 10 }), Exit.succeed({ limit: 50 }));
  });

  it.each([
    ["a limit of 0", { limit: 0 }],
    ["a limit above the maximum", { limit: 201 }],
    ["a fractional limit", { limit: 1.5 }],
    ["a malformed cursor", { cursor: "nope" }],
    ["an empty cursor", { cursor: "" }],
  ])("rejects %s", (_, query) => {
    assert.isTrue(Exit.isFailure(decode(query)));
  });
});

describe("RestrictPayload and LiftRestrictionPayload", () => {
  it("requires the restriction note", () => {
    const decode = Schema.decodeUnknownExit(RestrictPayload);
    assert.deepStrictEqual(
      decode({ note: "Spam." }),
      Exit.succeed({ note: "Spam." }),
    );
    assert.isTrue(Exit.isFailure(decode({})));
    assert.isTrue(Exit.isFailure(decode({ note: " Spam." })));
  });

  it("makes the lift note optional", () => {
    const decode = Schema.decodeUnknownExit(LiftRestrictionPayload);
    assert.deepStrictEqual(decode({}), Exit.succeed({}));
    assert.deepStrictEqual(
      decode({ note: "Ok." }),
      Exit.succeed({ note: "Ok." }),
    );
    assert.isTrue(Exit.isFailure(decode({ note: "" })));
    assert.isTrue(Exit.isFailure(decode({ note: null })));
  });
});
