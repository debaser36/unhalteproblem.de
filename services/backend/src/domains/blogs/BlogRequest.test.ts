import { assert, describe, it } from "@effect/vitest";
import { DateTime, Option } from "effect";
import { UserId } from "#domains/users/User";
import { BlogId } from "./Blog.ts";
import { BlogRequestId, BlogRequestRow, decide } from "./BlogRequest.ts";

const requester = UserId.make("8f3c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b");
const moderator = UserId.make("1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d");
const blogId = BlogId.make("2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e");

const t0 = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
const t1 = DateTime.makeUnsafe("2026-02-01T00:00:00Z");

const pending = BlogRequestRow.make({
  id: BlogRequestId.make("3c4d5e6f-7a8b-4c3d-8e4f-5a6b7c8d9e0f"),
  requesterId: requester,
  title: "Rust notes",
  description: "Notes on Rust",
  status: "pending",
  createdAt: t0,
  decidedAt: Option.none(),
  decidedBy: Option.none(),
  reason: Option.none(),
  blogId: Option.none(),
});

describe("decide", () => {
  it("approving records the subblog, the time and the moderator", () => {
    const approved = decide(
      pending,
      { status: "approved", blogId },
      moderator,
      t1,
    );
    assert.strictEqual(approved.status, "approved");
    assert.deepStrictEqual(approved.blogId, Option.some(blogId));
    assert.deepStrictEqual(approved.decidedAt, Option.some(t1));
    assert.deepStrictEqual(approved.decidedBy, Option.some(moderator));
    assert.deepStrictEqual(approved.reason, Option.none());
  });

  it("rejecting records the reason, the time and the moderator", () => {
    const rejected = decide(
      pending,
      { status: "rejected", reason: Option.some("Too vague") },
      moderator,
      t1,
    );
    assert.strictEqual(rejected.status, "rejected");
    assert.deepStrictEqual(rejected.reason, Option.some("Too vague"));
    assert.deepStrictEqual(rejected.blogId, Option.none());
    assert.deepStrictEqual(rejected.decidedAt, Option.some(t1));
    assert.deepStrictEqual(rejected.decidedBy, Option.some(moderator));
  });

  it("rejecting without a reason leaves it empty", () => {
    const rejected = decide(
      pending,
      { status: "rejected", reason: Option.none() },
      moderator,
      t1,
    );
    assert.strictEqual(rejected.status, "rejected");
    assert.deepStrictEqual(rejected.reason, Option.none());
  });

  it("withdrawing records the requester and clears reason and subblog", () => {
    // A row that (hypothetically) still carries both: withdrawing clears them.
    const stale = BlogRequestRow.make({
      ...pending,
      reason: Option.some("left over"),
      blogId: Option.some(blogId),
    });
    const withdrawn = decide(stale, { status: "withdrawn" }, requester, t1);
    assert.strictEqual(withdrawn.status, "withdrawn");
    assert.deepStrictEqual(withdrawn.reason, Option.none());
    assert.deepStrictEqual(withdrawn.blogId, Option.none());
    assert.deepStrictEqual(withdrawn.decidedAt, Option.some(t1));
    assert.deepStrictEqual(withdrawn.decidedBy, Option.some(requester));
  });

  it("keeps the rest of the request and does not change the original", () => {
    const approved = decide(
      pending,
      { status: "approved", blogId },
      moderator,
      t1,
    );
    assert.strictEqual(approved.id, pending.id);
    assert.strictEqual(approved.requesterId, pending.requesterId);
    assert.strictEqual(approved.title, pending.title);
    assert.strictEqual(approved.description, pending.description);
    assert.deepStrictEqual(approved.createdAt, t0);
    assert.strictEqual(pending.status, "pending");
    assert.deepStrictEqual(pending.decidedAt, Option.none());
    assert.deepStrictEqual(pending.blogId, Option.none());
  });
});
