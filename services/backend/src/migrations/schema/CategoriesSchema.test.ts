import { assert, describe, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient, type SqlError } from "effect/sql";
import {
  categoryId,
  describeColumns,
  describeConstraints,
  describeIndexes,
  insertBlog,
  insertCategory,
  insertPost,
  insertUser,
} from "./Helpers.ts";

import { DatabaseTest } from "#testing/Database";

const assertConstraint = (error: SqlError.SqlError, constraint: string) => {
  assert.strictEqual(error.reason._tag, "ConstraintError", constraint);
  assert.propertyVal(error.reason.cause, "constraint", constraint);
};

const assertUnique = (error: SqlError.SqlError, constraint: string) => {
  assert.strictEqual(error.reason._tag, "UniqueViolation", constraint);
  if (error.reason._tag === "UniqueViolation") {
    assert.strictEqual(error.reason.constraint, constraint);
  }
};

describe("DatabaseTest", () => {
  layer(DatabaseTest, { timeout: "30 seconds" })((it) => {
    it.effect("creates categories and the extra category tables", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeColumns(sql, "categories"), [
          "categories.id uuid not null",
          "categories.slug text not null",
          "categories.name text not null",
          "categories.created_at timestamp with time zone not null",
          "categories.created_by uuid",
        ]);
        assert.deepStrictEqual(
          yield* describeColumns(sql, "blog_extra_categories"),
          [
            "blog_extra_categories.blog_id uuid not null",
            "blog_extra_categories.category_id uuid not null",
          ],
        );
        assert.deepStrictEqual(
          yield* describeColumns(sql, "blog_post_extra_categories"),
          [
            "blog_post_extra_categories.post_id uuid not null",
            "blog_post_extra_categories.category_id uuid not null",
          ],
        );
      }),
    );

    it.effect("constrains and indexes the category tables", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* describeConstraints(sql, "categories"), [
          "categories_created_by_fkey: FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL",
          "categories_id_pkey: PRIMARY KEY (id)",
          "categories_name_check: CHECK ((((char_length(name) >= 1) AND (char_length(name) <= 48)) AND (name !~ '^[ \\t\\n\\v\\f\\r]|[ \\t\\n\\v\\f\\r]$'::text)))",
          "categories_slug_check: CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (char_length(slug) <= 48)))",
          "categories_slug_key: UNIQUE (slug)",
        ]);
        assert.deepStrictEqual(yield* describeIndexes(sql, "categories"), [
          "CREATE UNIQUE INDEX categories_id_pkey ON public.categories USING btree (id)",
          "CREATE UNIQUE INDEX categories_slug_key ON public.categories USING btree (slug)",
        ]);
        assert.deepStrictEqual(
          yield* describeConstraints(sql, "blog_extra_categories"),
          [
            "blog_extra_categories_blog_id_category_id_pkey: PRIMARY KEY (blog_id, category_id)",
            "blog_extra_categories_blog_id_fkey: FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE CASCADE",
            "blog_extra_categories_category_id_fkey: FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT",
          ],
        );
        assert.deepStrictEqual(
          yield* describeIndexes(sql, "blog_extra_categories"),
          [
            "CREATE UNIQUE INDEX blog_extra_categories_blog_id_category_id_pkey ON public.blog_extra_categories USING btree (blog_id, category_id)",
            "CREATE INDEX blog_extra_categories_category_id_blog_id_idx ON public.blog_extra_categories USING btree (category_id, blog_id)",
          ],
        );
        assert.deepStrictEqual(
          yield* describeConstraints(sql, "blog_post_extra_categories"),
          [
            "blog_post_extra_categories_category_id_fkey: FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT",
            "blog_post_extra_categories_post_id_category_id_pkey: PRIMARY KEY (post_id, category_id)",
            "blog_post_extra_categories_post_id_fkey: FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE",
          ],
        );
        assert.deepStrictEqual(
          yield* describeIndexes(sql, "blog_post_extra_categories"),
          [
            "CREATE INDEX blog_post_extra_categories_category_id_post_id_idx ON public.blog_post_extra_categories USING btree (category_id, post_id)",
            "CREATE UNIQUE INDEX blog_post_extra_categories_post_id_category_id_pkey ON public.blog_post_extra_categories USING btree (post_id, category_id)",
          ],
        );
      }),
    );

    it.effect("seeds the preset categories", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const presets = yield* sql<{
          readonly slug: string;
          readonly name: string;
          readonly createdBy: string | null;
          readonly milliseconds: boolean;
        }>`
          SELECT slug, name, created_by,
            created_at = date_trunc('milliseconds', created_at) AS milliseconds
          FROM categories
          WHERE created_by IS NULL
            AND slug IN (
              'programming', 'web-development', 'systems-and-infrastructure',
              'security', 'data-and-ai', 'tools-and-workflow', 'open-source',
              'career', 'personal', 'miscellaneous'
            )
          ORDER BY name
        `;
        assert.deepStrictEqual(
          presets.map((row) => [row.slug, row.name]),
          [
            ["career", "Career"],
            ["data-and-ai", "Data & AI"],
            ["miscellaneous", "Miscellaneous"],
            ["open-source", "Open Source"],
            ["personal", "Personal"],
            ["programming", "Programming"],
            ["security", "Security"],
            ["systems-and-infrastructure", "Systems & Infrastructure"],
            ["tools-and-workflow", "Tools & Workflow"],
            ["web-development", "Web Development"],
          ],
        );
        assert.isTrue(presets.every((row) => row.milliseconds));
      }),
    );

    it.effect("accepts valid categories and rejects invalid ones", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* insertCategory(sql, "c", "C");
        yield* insertCategory(sql, `check-${"a".repeat(42)}`, "n".repeat(48));
        // Code points, not UTF-16 code units; inner whitespace is fine.
        yield* insertCategory(sql, "check-2026-b", `${"😀".repeat(46)} x`);

        const cases = [
          ["", "Name", "categories_slug_check"],
          ["Upper", "Name", "categories_slug_check"],
          ["a_b", "Name", "categories_slug_check"],
          ["-a", "Name", "categories_slug_check"],
          ["a-", "Name", "categories_slug_check"],
          ["a--b", "Name", "categories_slug_check"],
          ["ä", "Name", "categories_slug_check"],
          ["a".repeat(49), "Name", "categories_slug_check"],
          ["check-name-a", "", "categories_name_check"],
          ["check-name-b", " Name", "categories_name_check"],
          ["check-name-c", "Name\n", "categories_name_check"],
          ["check-name-d", "\tName", "categories_name_check"],
          ["check-name-e", "n".repeat(49), "categories_name_check"],
        ] as const;
        for (const [slug, name, constraint] of cases) {
          const error = yield* insertCategory(sql, slug, name).pipe(
            Effect.tap(() =>
              Effect.sync(() => assert.fail(`accepted: ${constraint}`)),
            ),
            Effect.flip,
          );
          assertConstraint(error, constraint);
        }
        assertUnique(
          yield* insertCategory(sql, "c", "Duplicate").pipe(Effect.flip),
          "categories_slug_key",
        );
      }),
    );

    it.effect("requires a known main category on blogs and posts", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const unknown = crypto.randomUUID();
        assertConstraint(
          yield* insertBlog(sql, "main-unknown", null, unknown).pipe(
            Effect.flip,
          ),
          "blogs_main_category_id_fkey",
        );
        const missing = yield* sql`
          INSERT INTO blogs (id, slug, title, description, created_at, updated_at)
          VALUES (gen_random_uuid(), 'main-missing', 'T', '', now(), now())
        `.pipe(Effect.flip);
        assert.strictEqual(missing.reason._tag, "ConstraintError");

        const blogId = yield* insertBlog(sql, "main-known");
        assertConstraint(
          yield* insertPost(sql, {
            blogId,
            slug: "unknown",
            mainCategoryId: unknown,
          }).pipe(Effect.flip),
          "blog_posts_main_category_id_fkey",
        );
      }),
    );

    it.effect("keeps used categories and cascades the extras", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const editor = yield* insertUser(sql, "category-editor");
        const main = yield* insertCategory(sql, "used-main", "Used main");
        const extra = yield* insertCategory(
          sql,
          "used-extra",
          "Used extra",
          editor,
        );
        const unused = yield* insertCategory(sql, "unused", "Unused");
        const blogId = yield* insertBlog(sql, "category-restrict", null, main);
        const postId = yield* insertPost(sql, {
          blogId,
          slug: "post",
          mainCategoryId: main,
        });
        yield* sql`
          INSERT INTO blog_extra_categories (blog_id, category_id)
          VALUES (${blogId}, ${extra})
        `;
        yield* sql`
          INSERT INTO blog_post_extra_categories (post_id, category_id)
          VALUES (${postId}, ${extra})
        `;
        // Each extra at most once.
        assertUnique(
          yield* sql`
            INSERT INTO blog_post_extra_categories (post_id, category_id)
            VALUES (${postId}, ${extra})
          `.pipe(Effect.flip),
          "blog_post_extra_categories_post_id_category_id_pkey",
        );
        assertUnique(
          yield* sql`
            INSERT INTO blog_extra_categories (blog_id, category_id)
            VALUES (${blogId}, ${extra})
          `.pipe(Effect.flip),
          "blog_extra_categories_blog_id_category_id_pkey",
        );

        // ON DELETE RESTRICT, as main and as extra category.
        const deleteCategory = (id: string) =>
          sql`DELETE FROM categories WHERE id = ${id}`.pipe(Effect.flip);
        const mainError = yield* deleteCategory(main);
        assert.strictEqual(mainError.reason._tag, "ConstraintError");
        assert.include(
          ["blogs_main_category_id_fkey", "blog_posts_main_category_id_fkey"],
          (mainError.reason.cause as { readonly constraint: string })
            .constraint,
        );
        const extraError = yield* deleteCategory(extra);
        assert.strictEqual(extraError.reason._tag, "ConstraintError");
        assert.include(
          [
            "blog_extra_categories_category_id_fkey",
            "blog_post_extra_categories_category_id_fkey",
          ],
          (extraError.reason.cause as { readonly constraint: string })
            .constraint,
        );
        yield* sql`DELETE FROM categories WHERE id = ${unused}`;

        // Deleting the creator keeps the category.
        yield* sql`DELETE FROM users WHERE id = ${editor}`;
        const [created] = yield* sql<{ readonly createdBy: string | null }>`
          SELECT created_by FROM categories WHERE id = ${extra}
        `;
        assert.deepStrictEqual(created, { createdBy: null });

        // ON DELETE CASCADE: deleting the post, then the blog, removes
        // their extras, after which the categories are unused.
        yield* sql`DELETE FROM blog_posts WHERE id = ${postId}`;
        const postExtras = yield* sql`
          SELECT 1 FROM blog_post_extra_categories WHERE post_id = ${postId}
        `;
        assert.strictEqual(postExtras.length, 0);
        assertConstraint(
          yield* deleteCategory(extra),
          "blog_extra_categories_category_id_fkey",
        );
        yield* sql`DELETE FROM blogs WHERE id = ${blogId}`;
        const blogExtras = yield* sql`
          SELECT 1 FROM blog_extra_categories WHERE blog_id = ${blogId}
        `;
        assert.strictEqual(blogExtras.length, 0);
        yield* sql`DELETE FROM categories WHERE id IN (${main}, ${extra})`;
      }),
    );

    it.effect("finds posts by main or extra category", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const wanted = yield* insertCategory(sql, "filter-wanted", "Wanted");
        const blogId = yield* insertBlog(sql, "category-filter");
        const asMain = yield* insertPost(sql, {
          blogId,
          slug: "as-main",
          mainCategoryId: wanted,
        });
        const asExtra = yield* insertPost(sql, { blogId, slug: "as-extra" });
        yield* insertPost(sql, { blogId, slug: "other" });
        yield* sql`
          INSERT INTO blog_post_extra_categories (post_id, category_id)
          VALUES (${asExtra}, ${wanted})
        `;
        const found = yield* sql<{ readonly id: string }>`
          SELECT p.id FROM blog_posts p
          WHERE p.main_category_id = ${categoryId(sql, "filter-wanted")}
             OR EXISTS (
               SELECT 1 FROM blog_post_extra_categories e
               WHERE e.post_id = p.id AND e.category_id = ${wanted}
             )
          ORDER BY p.slug
        `;
        assert.deepStrictEqual(
          found.map((row) => row.id),
          [asExtra, asMain],
        );
      }),
    );

    it.effect("keeps word_count in sync with the content", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const [trigger] = yield* sql<{
          readonly tgname: string;
          readonly definition: string;
        }>`
          SELECT tgname, pg_get_triggerdef(oid) AS definition
          FROM pg_trigger
          WHERE tgrelid = 'blog_posts'::regclass AND NOT tgisinternal
        `;
        assert.deepStrictEqual(trigger, {
          tgname: "blog_posts_set_word_count_trigger",
          definition:
            "CREATE TRIGGER blog_posts_set_word_count_trigger BEFORE INSERT OR UPDATE OF content, word_count ON public.blog_posts FOR EACH ROW EXECUTE FUNCTION blog_posts_set_word_count()",
        });

        const doc = (text: string) =>
          JSON.stringify({
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          });
        const wordCount = (id: string) =>
          sql<{ readonly wordCount: number; readonly version: number }>`
            SELECT word_count, version FROM blog_posts WHERE id = ${id}
          `.pipe(Effect.map(([row]) => row));

        const blogId = yield* insertBlog(sql, "word-count");
        // Insert: the default is overwritten from the content.
        const postId = yield* insertPost(sql, {
          blogId,
          slug: "post",
          content: JSON.parse(doc("one  two\tthree ")),
        });
        assert.deepStrictEqual(yield* wordCount(postId), {
          wordCount: 3,
          version: 1,
        });
        // An insert naming word_count gets the computed count anyway.
        const [explicit] = yield* sql<{ readonly wordCount: number }>`
          INSERT INTO blog_posts (
            id, blog_id, slug, title, summary, content, status, created_at,
            updated_at, main_category_id, word_count
          )
          VALUES (
            gen_random_uuid(), ${blogId}, 'explicit', 'T', '',
            ${doc("a b")}::jsonb, 'draft', now(), now(),
            ${categoryId(sql, "miscellaneous")}, 99
          )
          RETURNING word_count
        `;
        assert.deepStrictEqual(explicit, { wordCount: 2 });

        // Updating the content recounts.
        yield* sql`
          UPDATE blog_posts SET content = ${doc("just one more word here")}::jsonb,
            version = version + 1
          WHERE id = ${postId}
        `;
        assert.deepStrictEqual(yield* wordCount(postId), {
          wordCount: 5,
          version: 2,
        });

        // An update that does not touch content keeps the count.
        yield* sql`
          UPDATE blog_posts SET title = 'Renamed', version = version + 1
          WHERE id = ${postId}
        `;
        assert.deepStrictEqual(yield* wordCount(postId), {
          wordCount: 5,
          version: 3,
        });

        // Setting word_count directly is recomputed too.
        yield* sql`UPDATE blog_posts SET word_count = 42 WHERE id = ${postId}`;
        assert.deepStrictEqual(yield* wordCount(postId), {
          wordCount: 5,
          version: 3,
        });
      }),
    );
  });
});
