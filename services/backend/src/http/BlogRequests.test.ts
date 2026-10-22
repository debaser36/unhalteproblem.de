import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { site } from "#testing/App";
import { type Json, json, makeBlogApp } from "#testing/Blogs";

/** An id no request has. */
const unknownId = "00000000-0000-4000-8000-000000000000";

/**
 * The app with a normal `user`, the `admin`, the `superAdmin` (without
 * `admin`), a second normal user `other`, and helpers for blog requests.
 */
const setup = Effect.gen(function* () {
  const app = yield* makeBlogApp();
  const { expect, call, sql, admin, superAdmin, user } = app;
  const other = yield* app.member("other");

  /** Requests a subblog as `cookie`; returns the `BlogRequest` (201). */
  const requestBlog = (
    cookie: string,
    title = "Rust notes",
    description = "Notes on Rust",
  ) =>
    expect(201, cookie, "POST", "/blog-requests", {
      body: { title, description },
    });

  const mine = (cookie: string) =>
    expect(200, cookie, "GET", "/blog-requests").pipe(
      Effect.map((body) => body as unknown as ReadonlyArray<Json>),
    );

  const withdraw = (cookie: string, id: unknown) =>
    call(cookie, "POST", `/blog-requests/${String(id)}/withdraw`);

  const approve = (cookie: string | undefined, id: unknown, slug: string) =>
    call(cookie, "POST", `/admin/blog-requests/${String(id)}/approve`, {
      body: { slug },
    });

  const reject = (cookie: string | undefined, id: unknown, body?: unknown) =>
    call(cookie, "POST", `/admin/blog-requests/${String(id)}/reject`, {
      body: body ?? {},
    });

  const listAll = (cookie: string, query = "") =>
    expect(200, cookie, "GET", `/admin/blog-requests${query}`).pipe(
      Effect.map((body) => body as unknown as ReadonlyArray<Json>),
    );

  /** The audit entries of `actions`, oldest first. */
  const audit = (...actions: ReadonlyArray<string>) =>
    sql(
      (sql) => sql<{
        readonly action: string;
        readonly actorId: string | null;
        readonly targetId: string | null;
        readonly detail: string | null;
      }>`
        SELECT action, actor_id, target_id, detail FROM audit_log
        WHERE ${sql.in("action", actions)}
        ORDER BY id
      `,
    );

  /** The roles the session of `cookie` shows. */
  const rolesOf = (cookie: string) =>
    Effect.gen(function* () {
      const response = yield* call(cookie, "GET", "/auth/session");
      assert.strictEqual(response.status, 200);
      const body = (yield* json(response)) as {
        user: { roles: Array<string> };
      };
      return body.user.roles;
    });

  const blogCount = sql(
    (sql) => sql<{ readonly count: number }>`
      SELECT count(*)::int AS count FROM blogs
    `,
  ).pipe(Effect.map((rows) => rows[0]?.count ?? 0));

  /** Sets when a request was made, to order them without waiting. */
  const madeAt = (id: unknown, iso: string) =>
    sql(
      (sql) => sql`
        UPDATE blog_requests SET created_at = ${new Date(iso)}
        WHERE id = ${String(id)}
      `,
    );

  /** Reads a response's JSON body after checking its status. */
  const body = (status: number, response: Response) =>
    Effect.gen(function* () {
      assert.strictEqual(response.status, status);
      return yield* json(response);
    });

  return {
    ...app,
    other,
    requestBlog,
    mine,
    withdraw,
    approve,
    reject,
    listAll,
    audit,
    rolesOf,
    blogCount,
    madeAt,
    body,
    admin,
    superAdmin,
    user,
  };
});

describe("requesting a blog", () => {
  it.effect("answers 201 with a pending request, listed for its owner", () =>
    Effect.gen(function* () {
      const { user, other, requestBlog, mine } = yield* setup;
      const created = yield* requestBlog(user.cookie, "Rust notes", "About it");
      assert.match(String(created["id"]), /^[0-9a-f-]{36}$/);
      assert.deepStrictEqual(
        { ...created, id: undefined, createdAt: undefined },
        {
          id: undefined,
          title: "Rust notes",
          description: "About it",
          status: "pending",
          createdAt: undefined,
          decidedAt: null,
          reason: null,
          blog: null,
        },
      );
      assert.match(String(created["createdAt"]), /^\d{4}-\d\d-\d\dT.*Z$/);

      assert.deepStrictEqual(yield* mine(user.cookie), [created]);
      // Other users do not see it.
      assert.deepStrictEqual(yield* mine(other.cookie), []);
    }),
  );

  it.effect("answers with Cache-Control: no-store", () =>
    Effect.gen(function* () {
      const { user, call } = yield* setup;
      const created = yield* call(user.cookie, "POST", "/blog-requests", {
        body: { title: "T", description: "" },
      });
      assert.strictEqual(created.status, 201);
      assert.strictEqual(created.headers.get("cache-control"), "no-store");
      const listed = yield* call(user.cookie, "GET", "/blog-requests");
      assert.strictEqual(listed.headers.get("cache-control"), "no-store");
    }),
  );

  it.effect("refuses a second request while one is pending (409)", () =>
    Effect.gen(function* () {
      const { user, other, call, requestBlog, mine } = yield* setup;
      const first = yield* requestBlog(user.cookie);
      const second = yield* call(user.cookie, "POST", "/blog-requests", {
        body: { title: "Another", description: "" },
      });
      assert.strictEqual(second.status, 409);
      assert.strictEqual(
        (yield* json(second))["_tag"],
        "BlogRequestAlreadyPending",
      );
      assert.deepStrictEqual(yield* mine(user.cookie), [first]);
      // The limit is per user.
      yield* requestBlog(other.cookie);
    }),
  );

  it.effect("lets the user request again after withdrawing", () =>
    Effect.gen(function* () {
      const { user, requestBlog, withdraw, mine, madeAt, body } = yield* setup;
      const first = yield* requestBlog(user.cookie, "First");
      const withdrawn = yield* body(
        200,
        yield* withdraw(user.cookie, first["id"]),
      );
      assert.strictEqual(withdrawn["status"], "withdrawn");
      assert.match(String(withdrawn["decidedAt"]), /^\d{4}-\d\d-\d\dT.*Z$/);
      assert.strictEqual(withdrawn["reason"], null);
      assert.strictEqual(withdrawn["blog"], null);

      const second = yield* requestBlog(user.cookie, "Second");
      yield* madeAt(first["id"], "2026-01-01T00:00:00Z");
      yield* madeAt(second["id"], "2026-01-02T00:00:00Z");
      // Newest first, the withdrawn one is kept.
      assert.deepStrictEqual(
        (yield* mine(user.cookie)).map(({ title, status }) => [title, status]),
        [
          ["Second", "pending"],
          ["First", "withdrawn"],
        ],
      );
    }),
  );

  it.effect("validates the payload (400)", () =>
    Effect.gen(function* () {
      const { user, call } = yield* setup;
      const payloads = [
        {},
        { title: "", description: "" },
        { title: " padded ", description: "" },
        { title: "x".repeat(121), description: "" },
        { title: "Title", description: "x".repeat(1001) },
        { title: "Title" },
      ];
      for (const payload of payloads) {
        const response = yield* call(user.cookie, "POST", "/blog-requests", {
          body: payload,
        });
        assert.strictEqual(response.status, 400, JSON.stringify(payload));
      }
    }),
  );
});

describe("withdrawing a blog request", () => {
  it.effect("answers 404 for another user's request, which stays pending", () =>
    Effect.gen(function* () {
      const { user, other, admin, requestBlog, withdraw, body, listAll } =
        yield* setup;
      const created = yield* requestBlog(user.cookie);
      for (const stranger of [other, admin]) {
        const error = yield* body(
          404,
          yield* withdraw(stranger.cookie, created["id"]),
        );
        assert.strictEqual(error["_tag"], "BlogRequestNotFound");
      }
      assert.deepStrictEqual(
        (yield* listAll(admin.cookie)).map(({ status }) => status),
        ["pending"],
      );
    }),
  );

  it.effect("answers 404 for an unknown id and 400 for an invalid one", () =>
    Effect.gen(function* () {
      const { user, withdraw, body, call } = yield* setup;
      const error = yield* body(404, yield* withdraw(user.cookie, unknownId));
      assert.strictEqual(error["_tag"], "BlogRequestNotFound");
      const invalid = yield* call(
        user.cookie,
        "POST",
        "/blog-requests/not-an-id/withdraw",
      );
      assert.strictEqual(invalid.status, 400);
    }),
  );

  it.effect("answers 409 for a request that is not pending any more", () =>
    Effect.gen(function* () {
      const {
        user,
        admin,
        other,
        requestBlog,
        withdraw,
        reject,
        approve,
        body,
      } = yield* setup;

      // Withdrawn twice.
      const first = yield* requestBlog(user.cookie);
      yield* body(200, yield* withdraw(user.cookie, first["id"]));
      const again = yield* body(409, yield* withdraw(user.cookie, first["id"]));
      assert.strictEqual(again["_tag"], "BlogRequestNotPending");
      assert.strictEqual(again["status"], "withdrawn");

      // Rejected.
      const second = yield* requestBlog(user.cookie);
      yield* body(200, yield* reject(admin.cookie, second["id"]));
      const rejected = yield* body(
        409,
        yield* withdraw(user.cookie, second["id"]),
      );
      assert.strictEqual(rejected["_tag"], "BlogRequestNotPending");
      assert.strictEqual(rejected["status"], "rejected");

      // Approved.
      const third = yield* requestBlog(other.cookie);
      yield* body(
        200,
        yield* approve(admin.cookie, third["id"], "approved-one"),
      );
      const approved = yield* body(
        409,
        yield* withdraw(other.cookie, third["id"]),
      );
      assert.strictEqual(approved["_tag"], "BlogRequestNotPending");
      assert.strictEqual(approved["status"], "approved");
    }),
  );
});

describe("approving a blog request", () => {
  it.effect(
    "creates the subblog, makes the requester its editor and writes the audit trail",
    () =>
      Effect.gen(function* () {
        const {
          user,
          admin,
          requestBlog,
          approve,
          body,
          expect,
          rolesOf,
          audit,
          mine,
          listAll,
        } = yield* setup;
        const created = yield* requestBlog(
          user.cookie,
          "Rust notes",
          "On Rust",
        );
        assert.notInclude(yield* rolesOf(user.cookie), "blogEditor:rust-notes");

        const approved = yield* body(
          200,
          yield* approve(admin.cookie, created["id"], "rust-notes"),
        );
        assert.strictEqual(approved["status"], "approved");
        assert.strictEqual(approved["blog"], "rust-notes");
        assert.strictEqual(approved["reason"], null);
        assert.strictEqual(approved["decidedBy"], admin.id);
        assert.match(String(approved["decidedAt"]), /^\d{4}-\d\d-\d\dT.*Z$/);
        assert.deepStrictEqual(approved["requester"], {
          id: user.id,
          username: "ada",
          name: null,
          deleted: false,
        });

        // The requester sees the outcome.
        const own = (yield* mine(user.cookie))[0];
        assert.strictEqual(own?.["status"], "approved");
        assert.strictEqual(own?.["blog"], "rust-notes");
        assert.notProperty(own ?? {}, "requester");
        assert.notProperty(own ?? {}, "decidedBy");

        // The subblog exists with the request's title and description.
        const blog = yield* expect(200, undefined, "GET", "/blogs/rust-notes");
        assert.strictEqual(blog["slug"], "rust-notes");
        assert.strictEqual(blog["title"], "Rust notes");
        assert.strictEqual(blog["description"], "On Rust");

        // The requester is its editor, effective at once.
        assert.include(yield* rolesOf(user.cookie), "blogEditor:rust-notes");
        const details = yield* expect(
          200,
          admin.cookie,
          "GET",
          `/admin/users/${user.id}`,
        );
        const grants = (details["roleChanges"] as Array<Json>).filter(
          ({ role }) => role === "blogEditor:rust-notes",
        );
        assert.deepStrictEqual(
          grants.map(({ change, changedBy }) => ({ change, changedBy })),
          [{ change: "granted", changedBy: admin.id }],
        );

        // The audit trail, in the order the approval writes it.
        assert.deepStrictEqual(
          yield* audit("blog_created", "role_granted", "blog_request_approved"),
          [
            {
              action: "role_granted",
              actorId: admin.id,
              targetId: user.id,
              detail: "blogEditor:rust-notes",
            },
            {
              action: "blog_created",
              actorId: admin.id,
              targetId: null,
              detail: "rust-notes",
            },
            {
              action: "blog_request_approved",
              actorId: admin.id,
              targetId: user.id,
              detail: "rust-notes",
            },
          ],
        );

        // The editor can write in the new subblog.
        yield* expect(
          201,
          user.cookie,
          "POST",
          "/blogs/rust-notes/manage/posts",
          {
            body: {
              slug: "first",
              title: "First",
              summary: "",
              tags: [],
              categories: { main: "Programming", extra: [] },
              coverImage: null,
              content: { type: "doc", content: [] },
            },
          },
        );

        // And the admin list shows it as approved.
        assert.deepStrictEqual(
          (yield* listAll(admin.cookie)).map(({ status, blog }) => [
            status,
            blog,
          ]),
          [["approved", "rust-notes"]],
        );
      }),
  );

  it.effect("lets a superAdmin without admin approve", () =>
    Effect.gen(function* () {
      const { user, superAdmin, requestBlog, approve, body, rolesOf, audit } =
        yield* setup;
      const created = yield* requestBlog(user.cookie, "Notes");
      const approved = yield* body(
        200,
        yield* approve(superAdmin.cookie, created["id"], "notes"),
      );
      assert.strictEqual(approved["status"], "approved");
      assert.strictEqual(approved["decidedBy"], superAdmin.id);
      assert.include(yield* rolesOf(user.cookie), "blogEditor:notes");
      assert.isTrue(
        (yield* audit("blog_request_approved")).every(
          ({ actorId }) => actorId === superAdmin.id,
        ),
      );
    }),
  );

  it.effect(
    "answers 409 BlogSlugTaken and changes nothing for a taken slug",
    () =>
      Effect.gen(function* () {
        const {
          user,
          admin,
          createBlog,
          requestBlog,
          approve,
          body,
          mine,
          rolesOf,
          audit,
          blogCount,
          expect,
        } = yield* setup;
        yield* createBlog("taken", "Existing");
        const created = yield* requestBlog(user.cookie, "Mine", "Mine!");
        const before = yield* blogCount;
        const auditBefore = yield* audit(
          "blog_created",
          "role_granted",
          "blog_request_approved",
        );

        const error = yield* body(
          409,
          yield* approve(admin.cookie, created["id"], "taken"),
        );
        assert.strictEqual(error["_tag"], "BlogSlugTaken");
        assert.strictEqual(error["blog"], "taken");

        // Still pending, no role, no new subblog, the old one untouched.
        assert.deepStrictEqual(yield* mine(user.cookie), [created]);
        assert.deepStrictEqual(yield* rolesOf(user.cookie), ["normalUser"]);
        assert.strictEqual(yield* blogCount, before);
        assert.deepStrictEqual(
          yield* audit("blog_created", "role_granted", "blog_request_approved"),
          auditBefore,
        );
        const existing = yield* expect(200, undefined, "GET", "/blogs/taken");
        assert.strictEqual(existing["title"], "Existing");

        // The request can still be approved with another slug.
        const approved = yield* body(
          200,
          yield* approve(admin.cookie, created["id"], "free"),
        );
        assert.strictEqual(approved["blog"], "free");
      }),
  );

  it.effect(
    "refuses the moderator's own request (403) and changes nothing",
    () =>
      Effect.gen(function* () {
        const {
          admin,
          superAdmin,
          requestBlog,
          approve,
          reject,
          mine,
          rolesOf,
          blogCount,
        } = yield* setup;
        const before = yield* blogCount;
        for (const moderator of [admin, superAdmin]) {
          const created = yield* requestBlog(moderator.cookie, "Mine");
          const approval = yield* approve(
            moderator.cookie,
            created["id"],
            `slug-${moderator.subject}`,
          );
          assert.strictEqual(approval.status, 403);
          const rejection = yield* reject(moderator.cookie, created["id"]);
          assert.strictEqual(rejection.status, 403);
          assert.deepStrictEqual(yield* mine(moderator.cookie), [created]);
        }
        assert.notInclude(
          yield* rolesOf(admin.cookie),
          "blogEditor:slug-admin",
        );
        assert.strictEqual(yield* blogCount, before);
      }),
  );

  it.effect("answers 409 for a request that is already decided", () =>
    Effect.gen(function* () {
      const {
        user,
        other,
        admin,
        requestBlog,
        approve,
        reject,
        withdraw,
        body,
        blogCount,
      } = yield* setup;
      const approvedRequest = yield* requestBlog(user.cookie);
      yield* body(
        200,
        yield* approve(admin.cookie, approvedRequest["id"], "once"),
      );
      const rejectedRequest = yield* requestBlog(other.cookie);
      yield* body(200, yield* reject(admin.cookie, rejectedRequest["id"]));
      const withdrawnRequest = yield* requestBlog(user.cookie);
      yield* body(200, yield* withdraw(user.cookie, withdrawnRequest["id"]));
      const before = yield* blogCount;

      const cases = [
        [approvedRequest, "approved"],
        [rejectedRequest, "rejected"],
        [withdrawnRequest, "withdrawn"],
      ] as const;
      for (const [request, status] of cases) {
        const approval = yield* body(
          409,
          yield* approve(admin.cookie, request["id"], "twice"),
        );
        assert.strictEqual(approval["_tag"], "BlogRequestNotPending");
        assert.strictEqual(approval["status"], status);
        const rejection = yield* body(
          409,
          yield* reject(admin.cookie, request["id"]),
        );
        assert.strictEqual(rejection["_tag"], "BlogRequestNotPending");
        assert.strictEqual(rejection["status"], status);
      }
      assert.strictEqual(yield* blogCount, before);
    }),
  );

  it.effect("answers 404 for an unknown request and 400 for a bad slug", () =>
    Effect.gen(function* () {
      const { user, admin, requestBlog, approve, body, blogCount } =
        yield* setup;
      const before = yield* blogCount;
      const unknown = yield* body(
        404,
        yield* approve(admin.cookie, unknownId, "slug"),
      );
      assert.strictEqual(unknown["_tag"], "BlogRequestNotFound");

      const created = yield* requestBlog(user.cookie);
      for (const slug of ["Upper", "has space", "", "-lead", "x".repeat(65)]) {
        const response = yield* approve(admin.cookie, created["id"], slug);
        assert.strictEqual(response.status, 400, slug);
      }
      assert.strictEqual(yield* blogCount, before);
    }),
  );

  it.effect(
    "answers 404 UserNotFound when the requester deleted their account",
    () =>
      Effect.gen(function* () {
        const {
          request,
          user,
          admin,
          requestBlog,
          approve,
          body,
          blogCount,
          listAll,
          expect,
          audit,
        } = yield* setup;
        const created = yield* requestBlog(user.cookie);
        const before = yield* blogCount;

        const deletion = yield* request("/account/delete", {
          method: "POST",
          headers: { origin: site, cookie: `__Host-session=${user.cookie}` },
        });
        assert.strictEqual(deletion.status, 204);

        const error = yield* body(
          404,
          yield* approve(admin.cookie, created["id"], "ghost"),
        );
        assert.strictEqual(error["_tag"], "UserNotFound");

        // Nothing was created, and the request is still open.
        assert.strictEqual(yield* blogCount, before);
        yield* expect(404, undefined, "GET", "/blogs/ghost");
        assert.deepStrictEqual(
          yield* audit("blog_created", "role_granted", "blog_request_approved"),
          [],
        );
        const [listed] = yield* listAll(admin.cookie);
        assert.strictEqual(listed?.["status"], "pending");
        assert.deepStrictEqual(listed?.["requester"], {
          id: user.id,
          username: null,
          name: null,
          deleted: true,
        });
      }),
  );
});

describe("rejecting a blog request", () => {
  it.effect("shows the requester the reason and audits it without", () =>
    Effect.gen(function* () {
      const {
        user,
        admin,
        requestBlog,
        reject,
        body,
        mine,
        audit,
        rolesOf,
        blogCount,
      } = yield* setup;
      const created = yield* requestBlog(user.cookie);
      const before = yield* blogCount;

      const rejected = yield* body(
        200,
        yield* reject(admin.cookie, created["id"], { reason: "Too vague" }),
      );
      assert.strictEqual(rejected["status"], "rejected");
      assert.strictEqual(rejected["reason"], "Too vague");
      assert.strictEqual(rejected["blog"], null);
      assert.strictEqual(rejected["decidedBy"], admin.id);
      assert.match(String(rejected["decidedAt"]), /^\d{4}-\d\d-\d\dT.*Z$/);

      const own = (yield* mine(user.cookie))[0];
      assert.strictEqual(own?.["status"], "rejected");
      assert.strictEqual(own?.["reason"], "Too vague");
      assert.strictEqual(own?.["blog"], null);

      assert.deepStrictEqual(yield* audit("blog_request_rejected"), [
        {
          action: "blog_request_rejected",
          actorId: admin.id,
          targetId: user.id,
          detail: null,
        },
      ]);
      assert.deepStrictEqual(yield* rolesOf(user.cookie), ["normalUser"]);
      assert.strictEqual(yield* blogCount, before);
    }),
  );

  it.effect("accepts a missing reason and a null reason", () =>
    Effect.gen(function* () {
      const { user, other, admin, requestBlog, reject, body, mine } =
        yield* setup;
      const first = yield* requestBlog(user.cookie);
      const second = yield* requestBlog(other.cookie);
      const withoutReason = yield* body(
        200,
        yield* reject(admin.cookie, first["id"], {}),
      );
      const nullReason = yield* body(
        200,
        yield* reject(admin.cookie, second["id"], { reason: null }),
      );
      for (const rejected of [withoutReason, nullReason]) {
        assert.strictEqual(rejected["status"], "rejected");
        assert.strictEqual(rejected["reason"], null);
      }
      assert.strictEqual((yield* mine(user.cookie))[0]?.["reason"], null);
      assert.strictEqual((yield* mine(other.cookie))[0]?.["reason"], null);
    }),
  );

  it.effect("lets a superAdmin without admin reject", () =>
    Effect.gen(function* () {
      const { user, superAdmin, requestBlog, reject, body } = yield* setup;
      const created = yield* requestBlog(user.cookie);
      const rejected = yield* body(
        200,
        yield* reject(superAdmin.cookie, created["id"], { reason: "No" }),
      );
      assert.strictEqual(rejected["status"], "rejected");
      assert.strictEqual(rejected["decidedBy"], superAdmin.id);
    }),
  );

  it.effect(
    "answers 404 for an unknown request and 400 for an invalid reason",
    () =>
      Effect.gen(function* () {
        const { user, admin, requestBlog, reject, body } = yield* setup;
        const unknown = yield* body(
          404,
          yield* reject(admin.cookie, unknownId),
        );
        assert.strictEqual(unknown["_tag"], "BlogRequestNotFound");

        const created = yield* requestBlog(user.cookie);
        for (const reason of ["", " padded ", "x".repeat(1001)]) {
          const response = yield* reject(admin.cookie, created["id"], {
            reason,
          });
          assert.strictEqual(response.status, 400, JSON.stringify(reason));
        }
      }),
  );
});

describe("listing blog requests as a moderator", () => {
  it.effect("filters by status and lists the newest first", () =>
    Effect.gen(function* () {
      const {
        user,
        other,
        admin,
        superAdmin,
        requestBlog,
        reject,
        listAll,
        madeAt,
        member,
        call,
      } = yield* setup;
      const third = yield* member("third");
      const oldest = yield* requestBlog(user.cookie, "Oldest");
      const middle = yield* requestBlog(other.cookie, "Middle");
      const newest = yield* requestBlog(third.cookie, "Newest");
      yield* madeAt(oldest["id"], "2026-01-01T00:00:00Z");
      yield* madeAt(middle["id"], "2026-01-02T00:00:00Z");
      yield* madeAt(newest["id"], "2026-01-03T00:00:00Z");
      yield* reject(admin.cookie, middle["id"], { reason: "No" });

      const titles = (rows: ReadonlyArray<Json>) =>
        rows.map(({ title }) => title);
      for (const moderator of [admin, superAdmin]) {
        assert.deepStrictEqual(titles(yield* listAll(moderator.cookie)), [
          "Newest",
          "Middle",
          "Oldest",
        ]);
      }
      assert.deepStrictEqual(
        titles(yield* listAll(admin.cookie, "?status=pending")),
        ["Newest", "Oldest"],
      );
      assert.deepStrictEqual(
        titles(yield* listAll(admin.cookie, "?status=rejected")),
        ["Middle"],
      );
      assert.deepStrictEqual(
        titles(yield* listAll(admin.cookie, "?status=approved")),
        [],
      );
      assert.deepStrictEqual(titles(yield* listAll(admin.cookie, "?limit=2")), [
        "Newest",
        "Middle",
      ]);

      const [first] = yield* listAll(admin.cookie, "?status=pending");
      assert.deepStrictEqual(first?.["requester"], {
        id: third.id,
        username: "ada",
        name: null,
        deleted: false,
      });
      assert.strictEqual(first?.["decidedBy"], null);

      for (const query of [
        "?status=bogus",
        "?limit=0",
        "?limit=201",
        "?limit=x",
      ]) {
        const response = yield* call(
          admin.cookie,
          "GET",
          `/admin/blog-requests${query}`,
        );
        assert.strictEqual(response.status, 400, query);
      }
    }),
  );
});

describe("blog request access", () => {
  /** Every endpoint, as a request. */
  const endpoints = (id: string) =>
    [
      {
        name: "listMyBlogRequests",
        method: "GET",
        path: "/blog-requests",
        admin: false,
        changes: false,
      },
      {
        name: "requestBlog",
        method: "POST",
        path: "/blog-requests",
        body: { title: "T", description: "" },
        admin: false,
        changes: true,
      },
      {
        name: "withdrawBlogRequest",
        method: "POST",
        path: `/blog-requests/${id}/withdraw`,
        admin: false,
        changes: true,
      },
      {
        name: "listBlogRequests",
        method: "GET",
        path: "/admin/blog-requests",
        admin: true,
        changes: false,
      },
      {
        name: "approveBlogRequest",
        method: "POST",
        path: `/admin/blog-requests/${id}/approve`,
        body: { slug: "intruder" },
        admin: true,
        changes: true,
      },
      {
        name: "rejectBlogRequest",
        method: "POST",
        path: `/admin/blog-requests/${id}/reject`,
        body: {},
        admin: true,
        changes: true,
      },
    ] as const;

  it.effect(
    "every endpoint requires a session (401), before anything else",
    () =>
      Effect.gen(function* () {
        const { call } = yield* setup;
        for (const endpoint of endpoints(unknownId)) {
          for (const cookie of [undefined, "unknown"]) {
            for (const origin of [undefined, null]) {
              const response = yield* call(
                cookie,
                endpoint.method,
                endpoint.path,
                {
                  body: "body" in endpoint ? endpoint.body : undefined,
                  origin,
                },
              );
              assert.strictEqual(
                response.status,
                401,
                `${endpoint.name} (cookie ${cookie}, origin ${origin})`,
              );
            }
          }
        }
      }),
  );

  it.effect(
    "a normal user gets 403 on the admin endpoints and changes nothing",
    () =>
      Effect.gen(function* () {
        const { user, other, call, requestBlog, mine, blogCount } =
          yield* setup;
        const created = yield* requestBlog(other.cookie);
        const before = yield* blogCount;
        for (const endpoint of endpoints(String(created["id"])).filter(
          ({ admin }) => admin,
        )) {
          const response = yield* call(
            user.cookie,
            endpoint.method,
            endpoint.path,
            {
              body: "body" in endpoint ? endpoint.body : undefined,
            },
          );
          assert.strictEqual(response.status, 403, endpoint.name);
        }
        assert.deepStrictEqual(yield* mine(other.cookie), [created]);
        assert.strictEqual(yield* blogCount, before);
      }),
  );

  it.effect("a blog editor is no moderator (403)", () =>
    Effect.gen(function* () {
      const { call, createBlog, editor, requestBlog, user } = yield* setup;
      yield* createBlog("alpha");
      const ed = yield* editor("ed", "alpha");
      const created = yield* requestBlog(user.cookie);
      const response = yield* call(
        ed.cookie,
        "POST",
        `/admin/blog-requests/${String(created["id"])}/reject`,
        { body: {} },
      );
      assert.strictEqual(response.status, 403);
    }),
  );

  it.effect("state-changing endpoints require the site's Origin (403)", () =>
    Effect.gen(function* () {
      const { admin, user, call, requestBlog, mine, listAll, blogCount } =
        yield* setup;
      const created = yield* requestBlog(user.cookie);
      const before = yield* blogCount;
      for (const endpoint of endpoints(String(created["id"])).filter(
        ({ changes }) => changes,
      )) {
        const cookie = endpoint.admin ? admin.cookie : user.cookie;
        for (const origin of [null, "https://evil.example"]) {
          const response = yield* call(cookie, endpoint.method, endpoint.path, {
            body: "body" in endpoint ? endpoint.body : undefined,
            origin,
          });
          assert.strictEqual(
            response.status,
            403,
            `${endpoint.name} (${origin})`,
          );
        }
      }
      // Nothing happened, and reading needs no Origin.
      assert.deepStrictEqual(yield* mine(user.cookie), [created]);
      assert.strictEqual(yield* blogCount, before);
      const read = yield* call(admin.cookie, "GET", "/admin/blog-requests", {
        origin: null,
      });
      assert.strictEqual(read.status, 200);
      assert.deepStrictEqual(
        (yield* listAll(admin.cookie)).map(({ status }) => status),
        ["pending"],
      );
    }),
  );
});
