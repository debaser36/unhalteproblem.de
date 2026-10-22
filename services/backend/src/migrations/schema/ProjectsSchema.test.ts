import { assert, describe, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import {
  describeColumns,
  describeConstraints,
  describeIndexes,
  insertUser,
  insertMedia,
  insertProject,
} from "./Helpers.ts";

import { DatabaseTest } from "#testing/Database";

describe("DatabaseTest", () => {
  layer(DatabaseTest, { timeout: "30 seconds" })((it) => {
    it.effect("creates the projects table with the expected columns", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeColumns(sql, "projects"), [
          "projects.id uuid not null",
          "projects.slug text not null",
          "projects.title text not null",
          "projects.summary text not null",
          "projects.tags ARRAY not null default '{}'::text[]",
          "projects.status text not null",
          "projects.featured boolean not null default false",
          "projects.position integer not null default 0",
          "projects.repo_url text",
          "projects.live_url text",
          "projects.cover_media_id uuid",
          "projects.content jsonb not null",
          "projects.published boolean not null default false",
          "projects.created_by uuid",
          "projects.updated_by uuid",
          "projects.created_at timestamp with time zone not null",
          "projects.updated_at timestamp with time zone not null",
          "projects.version integer not null default 1",
        ]);
      }),
    );

    it.effect("constrains and indexes projects", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeConstraints(sql, "projects"), [
          `projects_content_check: CHECK ((content @> '{"type": "doc"}'::jsonb))`,
          "projects_cover_media_id_fkey: FOREIGN KEY (cover_media_id) REFERENCES media(id) ON DELETE SET NULL",
          "projects_created_by_fkey: FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL",
          "projects_id_pkey: PRIMARY KEY (id)",
          "projects_live_url_check: CHECK (((live_url ~ '^https?://'::text) AND (char_length(live_url) <= 2048)))",
          'projects_position_check: CHECK ((("position" >= 0) AND ("position" <= 10000)))',
          "projects_repo_url_check: CHECK (((repo_url ~ '^https?://'::text) AND (char_length(repo_url) <= 2048)))",
          "projects_slug_check: CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (char_length(slug) <= 64)))",
          "projects_slug_key: UNIQUE (slug)",
          "projects_status_check: CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'archived'::text])))",
          "projects_summary_check: CHECK (((char_length(summary) <= 500) AND (summary !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
          "projects_tags_check: CHECK (((cardinality(tags) <= 10) AND blog_posts_tags_valid(tags)))",
          "projects_title_check: CHECK ((((char_length(title) >= 1) AND (char_length(title) <= 120)) AND (title !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
          "projects_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL",
          "projects_version_check: CHECK ((version >= 1))",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "projects"), [
          'CREATE INDEX projects_featured_position_updated_at_id_idx ON public.projects USING btree (featured DESC, "position", updated_at DESC, id) WHERE published',
          "CREATE UNIQUE INDEX projects_id_pkey ON public.projects USING btree (id)",
          "CREATE UNIQUE INDEX projects_slug_key ON public.projects USING btree (slug)",
        ]);
      }),
    );

    it.effect("accepts valid projects and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* insertProject(sql, { slug: "proj-a" });
        // The limits: 64-character slug, 120 title and 500 summary code
        // points, 10 tags of 32 characters, position 0 and 10000, URLs of
        // 2048 characters.
        const longUrl = `https://example.com/${"a".repeat(2048 - 20)}`;
        assert.strictEqual(longUrl.length, 2048);
        yield* insertProject(sql, {
          slug: `proj-${"a".repeat(59)}`,
          title: "😀".repeat(120),
          summary: "😀 \n😀".repeat(100),
          tags: Array.from({ length: 10 }, (_, i) => `${i}`.repeat(32)),
          status: "completed",
          featured: true,
          position: 10000,
          repoUrl: longUrl,
          liveUrl: "http://localhost:8080/",
          published: true,
          version: 3,
        });
        yield* insertProject(sql, {
          slug: "proj-b",
          status: "archived",
          repoUrl: "https://github.com/x/y",
          liveUrl: null,
        });

        const cases = [
          [{ slug: "" }, "projects_slug_check"],
          [{ slug: "Proj" }, "projects_slug_check"],
          [{ slug: "proj--c" }, "projects_slug_check"],
          [{ slug: "proj_c" }, "projects_slug_check"],
          [{ slug: `proj-${"a".repeat(60)}` }, "projects_slug_check"],
          [{ title: "" }, "projects_title_check"],
          [{ title: "t".repeat(121) }, "projects_title_check"],
          [{ title: " T" }, "projects_title_check"],
          [{ summary: "s".repeat(501) }, "projects_summary_check"],
          [{ summary: "s\n" }, "projects_summary_check"],
          [
            { tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`) },
            "projects_tags_check",
          ],
          [{ tags: ["rust", "rust"] }, "projects_tags_check"],
          [{ tags: ["Rust"] }, "projects_tags_check"],
          [{ tags: ["t".repeat(33)] }, "projects_tags_check"],
          [{ tags: ["rust", null] }, "projects_tags_check"],
          [{ status: "draft" }, "projects_status_check"],
          [{ status: "Active" }, "projects_status_check"],
          [{ position: -1 }, "projects_position_check"],
          [{ position: 10001 }, "projects_position_check"],
          [{ repoUrl: "" }, "projects_repo_url_check"],
          [{ repoUrl: "ftp://example.com" }, "projects_repo_url_check"],
          [{ repoUrl: "javascript:alert(1)" }, "projects_repo_url_check"],
          [{ repoUrl: "//example.com" }, "projects_repo_url_check"],
          [{ repoUrl: " https://example.com" }, "projects_repo_url_check"],
          [{ repoUrl: `${longUrl}a` }, "projects_repo_url_check"],
          [{ liveUrl: "example.com" }, "projects_live_url_check"],
          [{ liveUrl: "data:text/html,x" }, "projects_live_url_check"],
          [{ liveUrl: `${longUrl}a` }, "projects_live_url_check"],
          [{ content: [] }, "projects_content_check"],
          [{ content: "doc" }, "projects_content_check"],
          [{ content: { type: "paragraph" } }, "projects_content_check"],
          [{ version: 0 }, "projects_version_check"],
        ] as const;
        for (const [project, constraint] of cases) {
          const error = yield* insertProject(sql, {
            slug: "proj-invalid",
            ...project,
          }).pipe(
            Effect.tap(() =>
              Effect.sync(() => assert.fail(`accepted: ${constraint}`)),
            ),
            Effect.flip,
          );
          assert.strictEqual(error.reason._tag, "ConstraintError", constraint);
          assert.propertyVal(error.reason.cause, "constraint", constraint);
        }

        const duplicate = yield* insertProject(sql, { slug: "proj-a" }).pipe(
          Effect.flip,
        );
        assert.strictEqual(duplicate.reason._tag, "UniqueViolation");
        if (duplicate.reason._tag === "UniqueViolation") {
          assert.strictEqual(duplicate.reason.constraint, "projects_slug_key");
        }

        const unknownCover = yield* insertProject(sql, {
          slug: "proj-c",
          coverMediaId: "00000000-0000-4000-8000-000000000c01",
        }).pipe(Effect.flip);
        assert.propertyVal(
          unknownCover.reason.cause,
          "constraint",
          "projects_cover_media_id_fkey",
        );
        const unknownUser = yield* insertProject(sql, {
          slug: "proj-c",
          createdBy: "00000000-0000-4000-8000-000000000c02",
        }).pipe(Effect.flip);
        assert.propertyVal(
          unknownUser.reason.cause,
          "constraint",
          "projects_created_by_fkey",
        );
      }),
    );

    it.effect("keeps projects when their users and cover are deleted", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const admin = yield* insertUser(sql, "project-fk-admin");
        const mediaId = yield* insertMedia(sql, "projects", admin);
        const projectId = yield* insertProject(sql, {
          slug: "proj-fk",
          coverMediaId: mediaId,
          createdBy: admin,
        });

        yield* sql`DELETE FROM users WHERE id = ${admin}`;
        const [afterUser] = yield* sql<{
          readonly createdBy: string | null;
          readonly updatedBy: string | null;
          readonly coverMediaId: string | null;
        }>`
          SELECT created_by, updated_by, cover_media_id
          FROM projects WHERE id = ${projectId}
        `;
        assert.deepStrictEqual(afterUser, {
          createdBy: null,
          updatedBy: null,
          coverMediaId: mediaId,
        });

        yield* sql`DELETE FROM media WHERE id = ${mediaId}`;
        const [afterMedia] = yield* sql<{
          readonly coverMediaId: string | null;
        }>`
          SELECT cover_media_id FROM projects WHERE id = ${projectId}
        `;
        assert.deepStrictEqual(afterMedia, { coverMediaId: null });
      }),
    );

    it.effect("lists published projects with the listing index", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const listing = sql`
          SELECT slug FROM projects
          WHERE published AND slug LIKE 'list-%'
          ORDER BY featured DESC, position, updated_at DESC, id
        `;
        yield* insertProject(sql, {
          slug: "list-draft",
          featured: true,
          published: false,
        });
        yield* insertProject(sql, {
          slug: "list-plain-old",
          position: 1,
          published: true,
          updatedAt: "2026-01-01T00:00:00Z",
        });
        yield* insertProject(sql, {
          slug: "list-plain-new",
          position: 1,
          published: true,
          updatedAt: "2026-02-01T00:00:00Z",
        });
        yield* insertProject(sql, {
          slug: "list-plain-first",
          position: 0,
          published: true,
        });
        yield* insertProject(sql, {
          slug: "list-featured",
          featured: true,
          position: 50,
          published: true,
        });
        const rows = yield* sql<{ readonly slug: string }>`${listing}`;
        assert.deepStrictEqual(
          rows.map((row) => row.slug),
          [
            "list-featured",
            "list-plain-first",
            "list-plain-new",
            "list-plain-old",
          ],
        );

        // The table is tiny and has no statistics, so the planner would
        // prefer a sequential scan, or a bitmap scan and a sort.
        const plan = yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SET LOCAL enable_seqscan = off`;
            yield* sql`SET LOCAL enable_bitmapscan = off`;
            return yield* sql<Record<string, string>>`
              EXPLAIN
              SELECT id FROM projects
              WHERE published
              ORDER BY featured DESC, position, updated_at DESC, id
            `;
          }),
        );
        const text = plan.flatMap((row) => Object.values(row)).join("\n");
        assert.include(text, "projects_featured_position_updated_at_id_idx");
        // The index delivers the order; no sort step.
        assert.notInclude(text, "Sort");
      }),
    );
  });
});
