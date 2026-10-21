import { assert, describe, it } from "@effect/vitest";
import { DateTime, Exit, Schema } from "effect";
import {
  AdminBlogRequest,
  AdminBlogRequestQuery,
  ApproveBlogRequestPayload,
  BlogRequest,
  BlogRequestId,
  BlogRequestLimits,
  BlogRequestReason,
  BlogRequester,
  BlogRequestStatus,
  CreateBlogRequestPayload,
  RejectBlogRequestPayload,
} from "./BlogRequest.ts";

const requestId = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const adaId = "3f0c6a8e-2b1d-4c5e-9f7a-1b2c3d4e5f60";
const graceId = "8d7e6f5a-4b3c-4d2e-8f1a-0b9c8d7e6f5a";

const pending: typeof BlogRequest.Encoded = {
  id: requestId,
  title: "Rust notes",
  description: "Things I learn about Rust.",
  status: "pending",
  createdAt: "2026-02-01T10:00:00.000Z",
  decidedAt: null,
  reason: null,
  blog: null,
};

const approved: typeof BlogRequest.Encoded = {
  ...pending,
  status: "approved",
  decidedAt: "2026-02-02T10:00:00.000Z",
  blog: "rust-notes",
};

const rejected: typeof BlogRequest.Encoded = {
  ...pending,
  status: "rejected",
  decidedAt: "2026-02-02T10:00:00.000Z",
  reason: "Too similar to an existing blog.",
};

const requester: typeof BlogRequester.Encoded = {
  id: adaId,
  username: "ada",
  name: "Ada Lovelace",
  deleted: false,
};

describe("BlogRequestId", () => {
  const decode = Schema.decodeUnknownExit(BlogRequestId);

  it("is a UUID", () => {
    assert.isTrue(Exit.isSuccess(decode(requestId)));
    for (const bad of ["", "not-a-uuid", 1, null]) {
      assert.isTrue(Exit.isFailure(decode(bad)), String(bad));
    }
  });
});

describe("BlogRequestStatus", () => {
  it("lists the four states", () => {
    assert.deepStrictEqual(BlogRequestStatus.literals, [
      "pending",
      "approved",
      "rejected",
      "withdrawn",
    ]);
  });
});

describe("BlogRequestReason", () => {
  const decode = Schema.decodeUnknownExit(BlogRequestReason);

  it("accepts a trimmed text of 1 to 1000 characters", () => {
    assert.isTrue(Exit.isSuccess(decode("x")));
    assert.isTrue(
      Exit.isSuccess(decode("x".repeat(BlogRequestLimits.reasonMaxLength))),
    );
  });

  it.each([
    ["an empty text", ""],
    ["a blank text", "   "],
    ["a text with surrounding spaces", " no "],
    ["a text over the limit", "x".repeat(1001)],
    ["a text with NUL", "a\u0000b"],
    ["a number", 1],
  ])("rejects %s", (_, value) => {
    assert.isTrue(Exit.isFailure(decode(value)));
  });
});

describe("CreateBlogRequestPayload", () => {
  const decode = Schema.decodeUnknownExit(CreateBlogRequestPayload);

  it("takes a title and a description, which may be empty", () => {
    const payload = { title: "Rust notes", description: "" };
    assert.deepStrictEqual(decode(payload), Exit.succeed(payload));
  });

  it.each([
    ["no title", { description: "d" }],
    ["no description", { title: "t" }],
    ["an empty title", { title: "", description: "d" }],
    [
      "a title over 120 characters",
      { title: "x".repeat(121), description: "" },
    ],
    ["an untrimmed title", { title: " t ", description: "" }],
    [
      "a description over 1000 characters",
      { title: "t", description: "x".repeat(1001) },
    ],
  ])("rejects %s", (_, payload) => {
    assert.isTrue(Exit.isFailure(decode(payload)));
  });

  it("has no slug: the approving admin chooses it", () => {
    assert.deepStrictEqual(Object.keys(CreateBlogRequestPayload.fields), [
      "title",
      "description",
    ]);
  });
});

describe("BlogRequest", () => {
  const decode = Schema.decodeUnknownSync(BlogRequest);

  it("round-trips pending, approved and rejected requests", () => {
    for (const request of [pending, approved, rejected]) {
      assert.deepStrictEqual(
        Schema.encodeSync(BlogRequest)(decode(request)),
        request,
      );
    }
  });

  it("decodes the timestamps", () => {
    const request = decode(approved);
    assert.isTrue(
      DateTime.Equivalence(
        request.createdAt,
        DateTime.makeUnsafe("2026-02-01T10:00:00Z"),
      ),
    );
    assert.isNull(decode(pending).decidedAt);
    assert.isNotNull(request.decidedAt);
  });

  it("requires every field, null where there is no value", () => {
    for (const key of Object.keys(pending)) {
      const { [key as keyof typeof pending]: _, ...rest } = pending;
      assert.isTrue(
        Exit.isFailure(Schema.decodeUnknownExit(BlogRequest)(rest)),
        key,
      );
    }
  });

  it("rejects an unknown status", () => {
    assert.isTrue(
      Exit.isFailure(
        Schema.decodeUnknownExit(BlogRequest)({ ...pending, status: "done" }),
      ),
    );
  });
});

describe("BlogRequester", () => {
  it("allows a deleted account without username and name", () => {
    const deleted = { id: adaId, username: null, name: null, deleted: true };
    assert.deepStrictEqual(
      Schema.encodeSync(BlogRequester)(
        Schema.decodeUnknownSync(BlogRequester)(deleted),
      ),
      deleted,
    );
  });
});

describe("AdminBlogRequest", () => {
  const decode = Schema.decodeUnknownSync(AdminBlogRequest);

  it("is a BlogRequest with requester and decidedBy", () => {
    assert.deepStrictEqual(
      Object.keys(AdminBlogRequest.fields).sort(),
      [...Object.keys(BlogRequest.fields), "requester", "decidedBy"].sort(),
    );
    const request = { ...approved, requester, decidedBy: graceId };
    assert.deepStrictEqual(
      Schema.encodeSync(AdminBlogRequest)(decode(request)),
      request,
    );
    assert.isNull(decode({ ...pending, requester, decidedBy: null }).decidedBy);
  });

  it("requires the requester", () => {
    assert.isTrue(
      Exit.isFailure(
        Schema.decodeUnknownExit(AdminBlogRequest)({
          ...pending,
          decidedBy: null,
        }),
      ),
    );
  });
});

describe("ApproveBlogRequestPayload", () => {
  const decode = Schema.decodeUnknownExit(ApproveBlogRequestPayload);

  it("requires a valid slug", () => {
    assert.deepStrictEqual(
      decode({ slug: "rust-notes" }),
      Exit.succeed({ slug: "rust-notes" }),
    );
    for (const bad of [
      {},
      { slug: "" },
      { slug: "Rust Notes" },
      { slug: "-a" },
    ]) {
      assert.isTrue(Exit.isFailure(decode(bad)), JSON.stringify(bad));
    }
  });
});

describe("RejectBlogRequestPayload", () => {
  const decode = Schema.decodeUnknownExit(RejectBlogRequestPayload);

  it("takes an optional or null reason", () => {
    assert.deepStrictEqual(decode({}), Exit.succeed({}));
    assert.deepStrictEqual(
      decode({ reason: null }),
      Exit.succeed({ reason: null }),
    );
    assert.deepStrictEqual(
      decode({ reason: "No." }),
      Exit.succeed({ reason: "No." }),
    );
  });

  it.each([
    ["an empty reason", { reason: "" }],
    ["an untrimmed reason", { reason: " No. " }],
    ["a reason over 1000 characters", { reason: "x".repeat(1001) }],
  ])("rejects %s", (_, payload) => {
    assert.isTrue(Exit.isFailure(decode(payload)));
  });
});

describe("AdminBlogRequestQuery", () => {
  const decode = Schema.decodeUnknownExit(AdminBlogRequestQuery);

  it("fills in the default limit and lists all statuses", () => {
    assert.deepStrictEqual(
      decode({}),
      Exit.succeed({ limit: BlogRequestLimits.defaultLimit }),
    );
    assert.strictEqual(BlogRequestLimits.defaultLimit, 50);
  });

  it("takes a status and a limit", () => {
    assert.deepStrictEqual(
      decode({ status: "pending", limit: 5 }),
      Exit.succeed({ status: "pending", limit: 5 }),
    );
  });

  it("accepts the bounds of the limit", () => {
    assert.deepStrictEqual(decode({ limit: 1 }), Exit.succeed({ limit: 1 }));
    assert.deepStrictEqual(
      decode({ limit: BlogRequestLimits.maxLimit }),
      Exit.succeed({ limit: 200 }),
    );
  });

  it.each([
    ["a limit of 0", { limit: 0 }],
    ["a limit above the maximum", { limit: 201 }],
    ["a fractional limit", { limit: 1.5 }],
    ["an unknown status", { status: "done" }],
  ])("rejects %s", (_, query) => {
    assert.isTrue(Exit.isFailure(decode(query)));
  });
});
