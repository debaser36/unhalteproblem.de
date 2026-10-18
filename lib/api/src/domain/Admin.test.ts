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
  it("round-trips with nulls and with an active restriction", () => {
    const unrestricted = {
      ...adminUser,
      username: null,
      email: null,
      restriction: null,
    };
    for (const encoded of [adminUser, unrestricted]) {
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

describe("UserPage", () => {
  it("round-trips a page", () => {
    const page = { users: [adminUser], total: 1 };
    const decoded = Schema.decodeSync(UserPage)(page);
    assert.deepStrictEqual(Schema.encodeSync(UserPage)(decoded), page);
  });

  it("rejects a negative or fractional total", () => {
    const decode = Schema.decodeUnknownExit(UserPage);
    assert.isTrue(Exit.isFailure(decode({ users: [], total: -1 })));
    assert.isTrue(Exit.isFailure(decode({ users: [], total: 1.5 })));
  });
});

describe("UserPageQuery", () => {
  const decode = Schema.decodeUnknownExit(UserPageQuery);

  it("fills in the defaults", () => {
    assert.deepStrictEqual(
      decode({}),
      Exit.succeed({ limit: UserPageLimits.defaultLimit, offset: 0 }),
    );
    assert.deepStrictEqual(
      decode({ offset: 10 }),
      Exit.succeed({ limit: 50, offset: 10 }),
    );
  });

  it("accepts the bounds", () => {
    assert.deepStrictEqual(
      decode({ limit: 1, offset: 0 }),
      Exit.succeed({ limit: 1, offset: 0 }),
    );
    assert.deepStrictEqual(
      decode({ limit: UserPageLimits.maxLimit, offset: 1_000_000 }),
      Exit.succeed({ limit: 200, offset: 1_000_000 }),
    );
  });

  it.each([
    ["a limit of 0", { limit: 0 }],
    ["a limit above the maximum", { limit: 201 }],
    ["a fractional limit", { limit: 1.5 }],
    ["a negative offset", { offset: -1 }],
    ["a fractional offset", { offset: 0.5 }],
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
