import { assert, describe, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient, Statement } from "effect/sql";
import {
  describeColumns,
  describeConstraints,
  describeIndexes,
  insertUser,
  insertBlog,
  insertMedia,
  insertPost,
} from "./Helpers.ts";

import { DatabaseTest } from "#testing/Database";

describe("DatabaseTest", () => {
  layer(DatabaseTest, { timeout: "30 seconds" })((it) => {
    it.effect("creates the blogs, media and blog_posts tables", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // The timestamps have no default: the application sets them from the
        // Effect clock.
        assert.deepStrictEqual(yield* describeColumns(sql, "blogs"), [
          "blogs.id uuid not null",
          "blogs.slug text not null",
          "blogs.title text not null",
          "blogs.description text not null",
          "blogs.created_at timestamp with time zone not null",
          "blogs.created_by uuid",
          "blogs.updated_at timestamp with time zone not null",
        ]);
        assert.deepStrictEqual(yield* describeColumns(sql, "media"), [
          "media.id uuid not null",
          "media.content_type text not null",
          "media.data bytea not null",
          "media.byte_size integer not null",
          "media.sha256 bytea not null",
          "media.scope text not null",
          "media.uploaded_by uuid",
          "media.uploaded_at timestamp with time zone not null",
        ]);
        assert.deepStrictEqual(yield* describeColumns(sql, "blog_posts"), [
          "blog_posts.id uuid not null",
          "blog_posts.blog_id uuid not null",
          "blog_posts.slug text not null",
          "blog_posts.title text not null",
          "blog_posts.summary text not null",
          "blog_posts.tags ARRAY not null default '{}'::text[]",
          "blog_posts.cover_media_id uuid",
          "blog_posts.content jsonb not null",
          "blog_posts.status text not null",
          "blog_posts.published_at timestamp with time zone",
          "blog_posts.author_id uuid",
          "blog_posts.updated_by uuid",
          "blog_posts.created_at timestamp with time zone not null",
          "blog_posts.updated_at timestamp with time zone not null",
          "blog_posts.version integer not null default 1",
        ]);
      }),
    );

    it.effect("constrains and indexes blogs, media and blog_posts", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeConstraints(sql, "blogs"), [
          "blogs_created_by_fkey: FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL",
          "blogs_description_check: CHECK (((char_length(description) <= 1000) AND (description !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
          "blogs_id_pkey: PRIMARY KEY (id)",
          "blogs_slug_check: CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (char_length(slug) <= 64)))",
          "blogs_slug_key: UNIQUE (slug)",
          "blogs_title_check: CHECK ((((char_length(title) >= 1) AND (char_length(title) <= 120)) AND (title !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "blogs"), [
          "CREATE UNIQUE INDEX blogs_id_pkey ON public.blogs USING btree (id)",
          "CREATE UNIQUE INDEX blogs_slug_key ON public.blogs USING btree (slug)",
        ]);
        assert.deepStrictEqual(yield* describeConstraints(sql, "media"), [
          "media_byte_size_check: CHECK ((((byte_size >= 1) AND (byte_size <= 5242880)) AND (byte_size = octet_length(data))))",
          "media_content_type_check: CHECK ((content_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/webp'::text, 'image/gif'::text, 'image/avif'::text])))",
          "media_id_pkey: PRIMARY KEY (id)",
          "media_scope_check: CHECK (((scope ~ '^(blog:[a-z0-9]+(-[a-z0-9]+)*|projects)$'::text) AND (char_length(scope) <= 69)))",
          "media_sha256_check: CHECK ((sha256 = sha256(data)))",
          "media_uploaded_by_fkey: FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "media"), [
          "CREATE UNIQUE INDEX media_id_pkey ON public.media USING btree (id)",
          "CREATE INDEX media_scope_uploaded_at_idx ON public.media USING btree (scope, uploaded_at)",
        ]);
        assert.deepStrictEqual(yield* describeConstraints(sql, "blog_posts"), [
          "blog_posts_author_id_fkey: FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL",
          "blog_posts_blog_id_fkey: FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE RESTRICT",
          "blog_posts_blog_id_slug_key: UNIQUE (blog_id, slug)",
          `blog_posts_content_check: CHECK ((content @> '{"type": "doc"}'::jsonb))`,
          "blog_posts_cover_media_id_fkey: FOREIGN KEY (cover_media_id) REFERENCES media(id) ON DELETE SET NULL",
          "blog_posts_id_pkey: PRIMARY KEY (id)",
          "blog_posts_published_at_check: CHECK (((status = 'draft'::text) OR (published_at IS NOT NULL)))",
          "blog_posts_published_at_milliseconds_check: CHECK ((published_at = date_trunc('milliseconds'::text, published_at)))",
          "blog_posts_slug_check: CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (char_length(slug) <= 128)))",
          "blog_posts_status_check: CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])))",
          "blog_posts_summary_check: CHECK (((char_length(summary) <= 500) AND (summary !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
          "blog_posts_tags_check: CHECK (((cardinality(tags) <= 10) AND blog_posts_tags_valid(tags)))",
          "blog_posts_title_check: CHECK ((((char_length(title) >= 1) AND (char_length(title) <= 200)) AND (title !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
          "blog_posts_updated_by_fkey: FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL",
          "blog_posts_version_check: CHECK ((version >= 1))",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "blog_posts"), [
          "CREATE INDEX blog_posts_blog_id_published_at_id_idx ON public.blog_posts USING btree (blog_id, published_at DESC, id DESC) WHERE (status = 'published'::text)",
          "CREATE UNIQUE INDEX blog_posts_blog_id_slug_key ON public.blog_posts USING btree (blog_id, slug)",
          "CREATE INDEX blog_posts_blog_id_updated_at_idx ON public.blog_posts USING btree (blog_id, updated_at DESC)",
          "CREATE UNIQUE INDEX blog_posts_id_pkey ON public.blog_posts USING btree (id)",
          "CREATE INDEX blog_posts_published_at_id_idx ON public.blog_posts USING btree (published_at DESC, id DESC) WHERE (status = 'published'::text)",
          "CREATE INDEX blog_posts_tags_idx ON public.blog_posts USING gin (tags)",
        ]);
        // The tag rules a check cannot hold without a subquery.
        const [tagsValid] = yield* sql<{ readonly volatility: string }>`
          SELECT provolatile AS volatility FROM pg_proc
          WHERE proname = 'blog_posts_tags_valid'
        `;
        assert.deepStrictEqual(tagsValid, { volatility: "i" });
      }),
    );

    it.effect("accepts valid blogs and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const insert = (slug: string, title: string, description: string) =>
          sql`
            INSERT INTO blogs (id, slug, title, description, created_at, updated_at)
            VALUES (gen_random_uuid(), ${slug}, ${title}, ${description}, now(), now())
          `;
        yield* insert("check-a", "T", "");
        yield* insert(
          `check-${"a".repeat(58)}`,
          "t".repeat(120),
          "d".repeat(1000),
        );
        // Code points, not UTF-16 code units; inner whitespace is fine.
        yield* insert("check-2026-b", "😀".repeat(120), "😀 \n😀".repeat(250));

        const cases = [
          ["", "T", "", "blogs_slug_check"],
          ["Check", "T", "", "blogs_slug_check"],
          ["check--c", "T", "", "blogs_slug_check"],
          ["check-c-", "T", "", "blogs_slug_check"],
          ["check-ä", "T", "", "blogs_slug_check"],
          [`check-${"a".repeat(59)}`, "T", "", "blogs_slug_check"],
          ["check-c", "", "", "blogs_title_check"],
          ["check-c", "t".repeat(121), "", "blogs_title_check"],
          ["check-c", " T", "", "blogs_title_check"],
          ["check-c", "T\n", "", "blogs_title_check"],
          ["check-c", "T", "d".repeat(1001), "blogs_description_check"],
          ["check-c", "T", "d\t", "blogs_description_check"],
          ["check-c", "T", " ", "blogs_description_check"],
        ] as const;
        for (const [slug, title, description, constraint] of cases) {
          const error = yield* insert(slug, title, description).pipe(
            Effect.flip,
          );
          assert.strictEqual(error.reason._tag, "ConstraintError", constraint);
          assert.propertyVal(error.reason.cause, "constraint", constraint);
        }

        const duplicate = yield* insert("check-a", "Other", "").pipe(
          Effect.flip,
        );
        assert.strictEqual(duplicate.reason._tag, "UniqueViolation");
        if (duplicate.reason._tag === "UniqueViolation") {
          assert.strictEqual(duplicate.reason.constraint, "blogs_slug_key");
        }
      }),
    );

    it.effect("accepts valid media and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const valid = yield* insertMedia(sql, "projects");
        yield* insertMedia(sql, "blog:rust-notes");
        yield* insertMedia(sql, `blog:${"a".repeat(64)}`);
        // The largest upload, 5 MiB, built in the database.
        yield* sql`
          INSERT INTO media
            (id, content_type, data, byte_size, sha256, scope, uploaded_at)
          SELECT gen_random_uuid(), 'image/webp', d, octet_length(d),
            sha256(d), 'projects', now()
          FROM (SELECT convert_to(repeat('a', 5242880), 'UTF8') AS d) AS upload
        `;

        /** Inserts a copy of the valid row with one expression changed. */
        const insertWith = (
          column: "content_type" | "byte_size" | "sha256" | "scope" | "data",
          value: Statement.Fragment,
        ) => {
          const columns = {
            content_type: sql`content_type`,
            data: sql`data`,
            byte_size: sql`byte_size`,
            sha256: sql`sha256`,
            scope: sql`scope`,
          };
          return sql`
            INSERT INTO media
              (id, content_type, data, byte_size, sha256, scope, uploaded_at)
            SELECT gen_random_uuid(),
              ${column === "content_type" ? value : columns.content_type},
              ${column === "data" ? value : columns.data},
              ${column === "byte_size" ? value : columns.byte_size},
              ${column === "sha256" ? value : columns.sha256},
              ${column === "scope" ? value : columns.scope},
              uploaded_at
            FROM media WHERE id = ${valid}
          `.pipe(Effect.flip);
        };
        const cases = [
          ["content_type", sql`'image/svg+xml'`, "media_content_type_check"],
          ["content_type", sql`'IMAGE/PNG'`, "media_content_type_check"],
          ["byte_size", sql`byte_size + 1`, "media_byte_size_check"],
          ["byte_size", sql`0`, "media_byte_size_check"],
          ["sha256", sql`sha256(data || '\\x00'::bytea)`, "media_sha256_check"],
          [
            "sha256",
            sql`substring(sha256 from 1 for 31)`,
            "media_sha256_check",
          ],
          ["scope", sql`'blog:'`, "media_scope_check"],
          ["scope", sql`'blog:Rust'`, "media_scope_check"],
          ["scope", sql`'blog:a--b'`, "media_scope_check"],
          ["scope", sql`'project'`, "media_scope_check"],
          ["scope", sql`'projects:x'`, "media_scope_check"],
          ["scope", sql`'blog:' || repeat('a', 65)`, "media_scope_check"],
        ] as const;
        for (const [column, value, constraint] of cases) {
          const error = yield* insertWith(column, value);
          assert.strictEqual(error.reason._tag, "ConstraintError", constraint);
          assert.propertyVal(error.reason.cause, "constraint", constraint);
        }

        // Empty data: byte_size cannot be 0, so no size matches.
        const empty = yield* sql`
          INSERT INTO media
            (id, content_type, data, byte_size, sha256, scope, uploaded_at)
          VALUES (gen_random_uuid(), 'image/png', ''::bytea, 0,
            sha256(''::bytea), 'projects', now())
        `.pipe(Effect.flip);
        assert.propertyVal(
          empty.reason.cause,
          "constraint",
          "media_byte_size_check",
        );

        // One byte over 5 MiB.
        const tooLarge = yield* sql`
          INSERT INTO media
            (id, content_type, data, byte_size, sha256, scope, uploaded_at)
          SELECT gen_random_uuid(), 'image/png', d, octet_length(d),
            sha256(d), 'projects', now()
          FROM (SELECT convert_to(repeat('a', 5242881), 'UTF8') AS d) AS upload
        `.pipe(Effect.flip);
        assert.propertyVal(
          tooLarge.reason.cause,
          "constraint",
          "media_byte_size_check",
        );
      }),
    );

    it.effect("accepts valid posts and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const blogId = yield* insertBlog(sql, "post-checks");
        const otherBlogId = yield* insertBlog(sql, "post-checks-other");

        yield* insertPost(sql, { blogId, slug: "a" });
        yield* insertPost(sql, {
          blogId,
          slug: `b-${"a".repeat(126)}`,
          title: "😀".repeat(200),
          summary: "s".repeat(500),
          tags: Array.from({ length: 10 }, (_, i) => `tag-${i}`),
          status: "published",
          publishedAt: "2026-01-01T00:00:00.123Z",
          version: 7,
        });
        yield* insertPost(sql, { blogId, slug: "c", tags: ["t".repeat(32)] });
        // Unpublished again: a draft keeps its first publication time.
        yield* insertPost(sql, {
          blogId,
          slug: "d",
          publishedAt: "2026-01-01T00:00:00Z",
        });
        // The slug is unique per subblog only.
        yield* insertPost(sql, { blogId: otherBlogId, slug: "a" });

        const cases = [
          [{ slug: "" }, "blog_posts_slug_check"],
          [{ slug: "A" }, "blog_posts_slug_check"],
          [{ slug: "a_b" }, "blog_posts_slug_check"],
          [{ slug: "a".repeat(129) }, "blog_posts_slug_check"],
          [{ title: "" }, "blog_posts_title_check"],
          [{ title: "t".repeat(201) }, "blog_posts_title_check"],
          [{ title: "T " }, "blog_posts_title_check"],
          [{ summary: "s".repeat(501) }, "blog_posts_summary_check"],
          [{ summary: "\rs" }, "blog_posts_summary_check"],
          [
            { tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`) },
            "blog_posts_tags_check",
          ],
          [{ tags: ["rust", "rust"] }, "blog_posts_tags_check"],
          [{ tags: ["Rust"] }, "blog_posts_tags_check"],
          [{ tags: [""] }, "blog_posts_tags_check"],
          [{ tags: ["a--b"] }, "blog_posts_tags_check"],
          [{ tags: ["t".repeat(33)] }, "blog_posts_tags_check"],
          [{ tags: ["rust", null] }, "blog_posts_tags_check"],
          [{ content: [] }, "blog_posts_content_check"],
          [
            { content: [{ type: "doc", content: [] }] },
            "blog_posts_content_check",
          ],
          [{ content: "doc" }, "blog_posts_content_check"],
          [{ content: { type: "paragraph" } }, "blog_posts_content_check"],
          [{ content: { content: [] } }, "blog_posts_content_check"],
          [
            { status: "deleted", publishedAt: "2026-01-01T00:00:00Z" },
            "blog_posts_status_check",
          ],
          [{ status: "published" }, "blog_posts_published_at_check"],
          [
            { publishedAt: "2026-01-01T00:00:00.000001Z" },
            "blog_posts_published_at_milliseconds_check",
          ],
          [{ version: 0 }, "blog_posts_version_check"],
        ] as const;
        for (const [post, constraint] of cases) {
          const error = yield* insertPost(sql, {
            blogId,
            slug: "invalid",
            ...post,
          }).pipe(
            Effect.tap(() =>
              Effect.sync(() => assert.fail(`accepted: ${constraint}`)),
            ),
            Effect.flip,
          );
          assert.strictEqual(error.reason._tag, "ConstraintError", constraint);
          assert.propertyVal(error.reason.cause, "constraint", constraint);
        }

        // A two-dimensional array of valid, distinct tags.
        const nested = yield* sql`
          UPDATE blog_posts SET tags = '{{a,b},{c,d}}'
          WHERE blog_id = ${blogId} AND slug = 'a'
        `.pipe(Effect.flip);
        assert.propertyVal(
          nested.reason.cause,
          "constraint",
          "blog_posts_tags_check",
        );

        const duplicate = yield* insertPost(sql, { blogId, slug: "a" }).pipe(
          Effect.flip,
        );
        assert.strictEqual(duplicate.reason._tag, "UniqueViolation");
        if (duplicate.reason._tag === "UniqueViolation") {
          assert.strictEqual(
            duplicate.reason.constraint,
            "blog_posts_blog_id_slug_key",
          );
        }

        const unknownBlog = yield* insertPost(sql, {
          blogId: "00000000-0000-4000-8000-000000000b01",
          slug: "a",
        }).pipe(Effect.flip);
        assert.propertyVal(
          unknownBlog.reason.cause,
          "constraint",
          "blog_posts_blog_id_fkey",
        );
        const unknownCover = yield* insertPost(sql, {
          blogId,
          slug: "e",
          coverMediaId: "00000000-0000-4000-8000-000000000b02",
        }).pipe(Effect.flip);
        assert.propertyVal(
          unknownCover.reason.cause,
          "constraint",
          "blog_posts_cover_media_id_fkey",
        );
      }),
    );

    it.effect("keeps blogs, media and posts when their users are deleted", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const admin = yield* insertUser(sql, "blog-fk-admin");
        const editor = yield* insertUser(sql, "blog-fk-editor");
        const blogId = yield* insertBlog(sql, "blog-fk", admin);
        const mediaId = yield* insertMedia(sql, "blog:blog-fk", editor);
        const postId = yield* insertPost(sql, {
          blogId,
          slug: "post",
          coverMediaId: mediaId,
          authorId: editor,
        });

        yield* sql`DELETE FROM users WHERE id IN (${admin}, ${editor})`;

        const [blog] = yield* sql<{ readonly createdBy: string | null }>`
          SELECT created_by FROM blogs WHERE id = ${blogId}
        `;
        assert.deepStrictEqual(blog, { createdBy: null });
        const [media] = yield* sql<{ readonly uploadedBy: string | null }>`
          SELECT uploaded_by FROM media WHERE id = ${mediaId}
        `;
        assert.deepStrictEqual(media, { uploadedBy: null });
        const [post] = yield* sql<{
          readonly authorId: string | null;
          readonly updatedBy: string | null;
          readonly coverMediaId: string | null;
        }>`
          SELECT author_id, updated_by, cover_media_id
          FROM blog_posts WHERE id = ${postId}
        `;
        assert.deepStrictEqual(post, {
          authorId: null,
          updatedBy: null,
          coverMediaId: mediaId,
        });
      }),
    );

    it.effect("removes a deleted cover image and keeps blogs with posts", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const blogId = yield* insertBlog(sql, "blog-restrict");
        const emptyBlogId = yield* insertBlog(sql, "blog-restrict-empty");
        const mediaId = yield* insertMedia(sql, "blog:blog-restrict");
        const postId = yield* insertPost(sql, {
          blogId,
          slug: "post",
          coverMediaId: mediaId,
        });

        yield* sql`DELETE FROM media WHERE id = ${mediaId}`;
        const [post] = yield* sql<{ readonly coverMediaId: string | null }>`
          SELECT cover_media_id FROM blog_posts WHERE id = ${postId}
        `;
        assert.deepStrictEqual(post, { coverMediaId: null });

        // ON DELETE RESTRICT: a subblog with posts cannot be deleted.
        const error = yield* sql`DELETE FROM blogs WHERE id = ${blogId}`.pipe(
          Effect.flip,
        );
        assert.strictEqual(error.reason._tag, "ConstraintError");
        assert.propertyVal(
          error.reason.cause,
          "constraint",
          "blog_posts_blog_id_fkey",
        );
        yield* sql`DELETE FROM blogs WHERE id = ${emptyBlogId}`;
        yield* sql`DELETE FROM blog_posts WHERE id = ${postId}`;
        yield* sql`DELETE FROM blogs WHERE id = ${blogId}`;
        const rest = yield* sql`
          SELECT id FROM blogs WHERE id IN (${blogId}, ${emptyBlogId})
        `;
        assert.strictEqual(rest.length, 0);
      }),
    );

    it.effect(
      "uses the partial and GIN indexes for the public post lists",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          // The table is tiny, so the planner would prefer a sequential scan.
          const explain = (query: Statement.Fragment) =>
            sql
              .withTransaction(
                Effect.gen(function* () {
                  yield* sql`SET LOCAL enable_seqscan = off`;
                  return yield* sql<Record<string, string>>`EXPLAIN ${query}`;
                }),
              )
              .pipe(
                Effect.map((plan) =>
                  plan.flatMap((row) => Object.values(row)).join("\n"),
                ),
              );
          const blogId = "00000000-0000-4000-8000-000000000b03";
          assert.include(
            yield* explain(sql`
            SELECT id FROM blog_posts
            WHERE blog_id = ${blogId} AND status = 'published'
              AND (published_at, id) < (now(), ${blogId})
            ORDER BY published_at DESC, id DESC LIMIT 10
          `),
            "blog_posts_blog_id_published_at_id_idx",
          );
          assert.include(
            yield* explain(sql`
            SELECT id FROM blog_posts
            WHERE status = 'published'
              AND (published_at, id) < (now(), ${blogId})
            ORDER BY published_at DESC, id DESC LIMIT 10
          `),
            "blog_posts_published_at_id_idx",
          );
          assert.include(
            yield* explain(sql`
            SELECT id FROM blog_posts WHERE tags @> ARRAY['rust']
          `),
            "blog_posts_tags_idx",
          );
          assert.include(
            yield* explain(sql`
            SELECT id FROM blog_posts WHERE blog_id = ${blogId}
            ORDER BY updated_at DESC
          `),
            "blog_posts_blog_id_updated_at_idx",
          );
        }),
    );
  });
});
