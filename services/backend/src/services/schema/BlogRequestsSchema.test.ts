import { assert, describe, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import {
  describeColumns,
  describeConstraints,
  describeIndexes,
  insertBlog,
  insertBlogRequest,
  insertUser,
} from "./Helpers.ts";

import { DatabaseTest } from "#testing/Database";

const decidedAt = "2026-01-02T00:00:00Z";

describe("DatabaseTest", () => {
  layer(DatabaseTest, { timeout: "30 seconds" })((it) => {
    it.effect("creates the blog_requests table with the expected columns", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // No defaults: the application sets id, status and the timestamps.
        assert.deepStrictEqual(yield* describeColumns(sql, "blog_requests"), [
          "blog_requests.id uuid not null",
          "blog_requests.requester_id uuid not null",
          "blog_requests.title text not null",
          "blog_requests.description text not null",
          "blog_requests.status text not null",
          "blog_requests.created_at timestamp with time zone not null",
          "blog_requests.decided_at timestamp with time zone",
          "blog_requests.decided_by uuid",
          "blog_requests.reason text",
          "blog_requests.blog_id uuid",
        ]);
      }),
    );

    it.effect("constrains and indexes blog_requests", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(
          yield* describeConstraints(sql, "blog_requests"),
          [
            "blog_requests_blog_id_fkey: FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE SET NULL",
            "blog_requests_decided_by_fkey: FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL",
            "blog_requests_description_check: CHECK (((char_length(description) <= 1000) AND (description !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
            "blog_requests_id_pkey: PRIMARY KEY (id)",
            "blog_requests_reason_check: CHECK ((((char_length(reason) >= 1) AND (char_length(reason) <= 1000)) AND (reason !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
            "blog_requests_requester_id_fkey: FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE",
            "blog_requests_status_blog_id_check: CHECK (((status = 'approved'::text) OR (blog_id IS NULL)))",
            "blog_requests_status_check: CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text])))",
            "blog_requests_status_decided_at_check: CHECK (((status = 'pending'::text) = (decided_at IS NULL)))",
            "blog_requests_status_decided_by_check: CHECK (((status <> 'pending'::text) OR (decided_by IS NULL)))",
            "blog_requests_status_reason_check: CHECK (((status = 'rejected'::text) OR (reason IS NULL)))",
            "blog_requests_title_check: CHECK ((((char_length(title) >= 1) AND (char_length(title) <= 120)) AND (title !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
          ],
        );
        assert.deepStrictEqual(yield* describeIndexes(sql, "blog_requests"), [
          "CREATE UNIQUE INDEX blog_requests_id_pkey ON public.blog_requests USING btree (id)",
          "CREATE UNIQUE INDEX blog_requests_one_pending_per_user ON public.blog_requests USING btree (requester_id) WHERE (status = 'pending'::text)",
          "CREATE INDEX blog_requests_requester_id_created_at_id_idx ON public.blog_requests USING btree (requester_id, created_at DESC, id DESC)",
          "CREATE INDEX blog_requests_status_created_at_id_idx ON public.blog_requests USING btree (status, created_at DESC, id DESC)",
        ]);
      }),
    );

    it.effect("accepts valid blog requests and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const requesterId = yield* insertUser(sql, "blog-request-valid");
        const moderator = yield* insertUser(sql, "blog-request-moderator");
        const blogId = yield* insertBlog(sql, "blog-request-valid");

        // Every status, with what it may have. Only one may be pending.
        // The limits: 120 title, 1000 description and 1000 reason code
        // points.
        yield* insertBlogRequest(sql, {
          requesterId,
          title: "😀".repeat(120),
          description: "😀 \n😀".repeat(250),
        });
        yield* insertBlogRequest(sql, {
          requesterId,
          status: "approved",
          decidedAt,
          decidedBy: moderator,
          blogId,
        });
        // Approved, and the subblog deleted since.
        yield* insertBlogRequest(sql, {
          requesterId,
          status: "approved",
          decidedAt,
        });
        yield* insertBlogRequest(sql, {
          requesterId,
          status: "rejected",
          decidedAt,
          decidedBy: moderator,
          reason: "😀".repeat(1000),
        });
        yield* insertBlogRequest(sql, {
          requesterId,
          status: "rejected",
          decidedAt,
          decidedBy: moderator,
        });
        yield* insertBlogRequest(sql, {
          requesterId,
          status: "withdrawn",
          decidedAt,
          decidedBy: requesterId,
        });

        // Each case breaks exactly one constraint. Decided by default, so
        // that they don't collide with the pending request above.
        const cases = [
          [{ title: "" }, "blog_requests_title_check"],
          [{ title: "t".repeat(121) }, "blog_requests_title_check"],
          [{ title: " T" }, "blog_requests_title_check"],
          [{ title: "T\t" }, "blog_requests_title_check"],
          [
            { description: "d".repeat(1001) },
            "blog_requests_description_check",
          ],
          [{ description: "d\n" }, "blog_requests_description_check"],
          [{ status: "Pending" }, "blog_requests_status_check"],
          [{ status: "draft" }, "blog_requests_status_check"],
          [{ status: "rejected", reason: "" }, "blog_requests_reason_check"],
          [{ status: "rejected", reason: " r" }, "blog_requests_reason_check"],
          [
            { status: "rejected", reason: "r".repeat(1001) },
            "blog_requests_reason_check",
          ],
          // Pending exactly when undecided.
          [
            { status: "pending", decidedAt },
            "blog_requests_status_decided_at_check",
          ],
          [
            { status: "approved", decidedAt: null },
            "blog_requests_status_decided_at_check",
          ],
          [
            { status: "rejected", decidedAt: null },
            "blog_requests_status_decided_at_check",
          ],
          [
            { status: "withdrawn", decidedAt: null },
            "blog_requests_status_decided_at_check",
          ],
          [
            { status: "pending", decidedAt: null, decidedBy: moderator },
            "blog_requests_status_decided_by_check",
          ],
          // A reason only when rejected.
          [
            { status: "pending", decidedAt: null, reason: "r" },
            "blog_requests_status_reason_check",
          ],
          [
            { status: "approved", reason: "r" },
            "blog_requests_status_reason_check",
          ],
          [
            { status: "withdrawn", reason: "r" },
            "blog_requests_status_reason_check",
          ],
          // A subblog only when approved.
          [
            { status: "pending", decidedAt: null, blogId },
            "blog_requests_status_blog_id_check",
          ],
          [
            { status: "rejected", blogId },
            "blog_requests_status_blog_id_check",
          ],
          [
            { status: "withdrawn", blogId },
            "blog_requests_status_blog_id_check",
          ],
        ] as const;
        for (const [request, constraint] of cases) {
          const error = yield* insertBlogRequest(sql, {
            requesterId,
            status: "withdrawn",
            decidedAt,
            ...request,
          }).pipe(
            Effect.tap(() =>
              Effect.sync(() => assert.fail(`accepted: ${constraint}`)),
            ),
            Effect.flip,
          );
          assert.strictEqual(error.reason._tag, "ConstraintError", constraint);
          assert.propertyVal(error.reason.cause, "constraint", constraint);
        }

        const unknown = "00000000-0000-4000-8000-000000000b01";
        const foreignKeys = [
          [{ requesterId: unknown }, "blog_requests_requester_id_fkey"],
          [{ decidedBy: unknown }, "blog_requests_decided_by_fkey"],
          [
            { status: "approved", blogId: unknown },
            "blog_requests_blog_id_fkey",
          ],
        ] as const;
        for (const [request, constraint] of foreignKeys) {
          const error = yield* insertBlogRequest(sql, {
            requesterId,
            status: "withdrawn",
            decidedAt,
            ...request,
          }).pipe(Effect.flip);
          assert.propertyVal(error.reason.cause, "constraint", constraint);
        }
      }),
    );

    it.effect("allows one pending request per user", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const alice = yield* insertUser(sql, "blog-request-pending-alice");
        const bob = yield* insertUser(sql, "blog-request-pending-bob");
        const first = yield* insertBlogRequest(sql, { requesterId: alice });
        // Decided requests don't count, and other users have their own.
        yield* insertBlogRequest(sql, {
          requesterId: alice,
          status: "rejected",
          decidedAt,
        });
        yield* insertBlogRequest(sql, { requesterId: bob });

        const duplicate = yield* insertBlogRequest(sql, {
          requesterId: alice,
        }).pipe(Effect.flip);
        assert.strictEqual(duplicate.reason._tag, "UniqueViolation");
        if (duplicate.reason._tag === "UniqueViolation") {
          // The name the application recognises.
          assert.strictEqual(
            duplicate.reason.constraint,
            "blog_requests_one_pending_per_user",
          );
        }

        // Once the first is withdrawn, a new one may be pending.
        yield* sql`
          UPDATE blog_requests
          SET status = 'withdrawn', decided_at = ${decidedAt},
            decided_by = ${alice}
          WHERE id = ${first}
        `;
        yield* insertBlogRequest(sql, { requesterId: alice });
      }),
    );

    it.effect(
      "keeps decided requests when the moderator or subblog is deleted",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const requester = yield* insertUser(sql, "blog-request-fk-user");
          const moderator = yield* insertUser(sql, "blog-request-fk-admin");
          const blogId = yield* insertBlog(sql, "blog-request-fk");
          const requestId = yield* insertBlogRequest(sql, {
            requesterId: requester,
            status: "approved",
            decidedAt,
            decidedBy: moderator,
            blogId,
          });
          const select = sql<{
            readonly status: string;
            readonly decidedBy: string | null;
            readonly blogId: string | null;
          }>`
            SELECT status, decided_by, blog_id FROM blog_requests
            WHERE id = ${requestId}
          `;

          yield* sql`DELETE FROM users WHERE id = ${moderator}`;
          assert.deepStrictEqual(yield* select, [
            { status: "approved", decidedBy: null, blogId },
          ]);

          yield* sql`DELETE FROM blogs WHERE id = ${blogId}`;
          assert.deepStrictEqual(yield* select, [
            { status: "approved", decidedBy: null, blogId: null },
          ]);

          // Deleting the requester (only an operator in SQL) removes them.
          yield* sql`DELETE FROM users WHERE id = ${requester}`;
          assert.deepStrictEqual(yield* select, []);
        }),
    );

    it.effect("lists requests newest first by requester and by status", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const alice = yield* insertUser(sql, "blog-request-list-alice");
        const bob = yield* insertUser(sql, "blog-request-list-bob");
        const insert = (
          requesterId: string,
          title: string,
          createdAt: string,
          status = "withdrawn",
        ) =>
          insertBlogRequest(sql, {
            requesterId,
            title,
            createdAt,
            status,
            decidedAt: status === "pending" ? null : decidedAt,
          });
        yield* insert(alice, "list-a-old", "2026-01-01T00:00:00Z");
        yield* insert(alice, "list-a-new", "2026-03-01T00:00:00Z", "pending");
        yield* insert(alice, "list-a-mid", "2026-02-01T00:00:00Z");
        yield* insert(bob, "list-b", "2026-02-15T00:00:00Z", "pending");

        const own = yield* sql<{ readonly title: string }>`
          SELECT title FROM blog_requests WHERE requester_id = ${alice}
          ORDER BY created_at DESC, id DESC LIMIT 50
        `;
        assert.deepStrictEqual(
          own.map((row) => row.title),
          ["list-a-new", "list-a-mid", "list-a-old"],
        );
        const pending = yield* sql<{ readonly title: string }>`
          SELECT title FROM blog_requests
          WHERE status = ${"pending"} AND title LIKE 'list-%'
          ORDER BY created_at DESC, id DESC LIMIT 50
        `;
        assert.deepStrictEqual(
          pending.map((row) => row.title),
          ["list-a-new", "list-b"],
        );
      }),
    );

    it.effect("uses the indexes for both lists, without a sort", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The table is tiny and has no statistics, so the planner would
        // prefer a sequential scan, or a bitmap scan and a sort.
        const explain = <E>(
          query: Effect.Effect<ReadonlyArray<Record<string, string>>, E>,
        ) =>
          sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`SET LOCAL enable_seqscan = off`;
              yield* sql`SET LOCAL enable_bitmapscan = off`;
              const plan = yield* query;
              return plan.flatMap((row) => Object.values(row)).join("\n");
            }),
          );

        const own = yield* explain(
          sql<Record<string, string>>`
            EXPLAIN
            SELECT id FROM blog_requests
            WHERE requester_id = ${"00000000-0000-4000-8000-000000000b02"}
            ORDER BY created_at DESC, id DESC LIMIT 50
          `,
        );
        assert.include(own, "blog_requests_requester_id_created_at_id_idx");
        assert.notInclude(own, "Sort");

        const byStatus = yield* explain(
          sql<Record<string, string>>`
            EXPLAIN
            SELECT id FROM blog_requests
            WHERE status = ${"pending"}
            ORDER BY created_at DESC, id DESC LIMIT 50
          `,
        );
        assert.include(byStatus, "blog_requests_status_created_at_id_idx");
        assert.notInclude(byStatus, "Sort");
      }),
    );
  });
});
