import { assert, describe, it } from "@effect/vitest";
import { PgliteMigrator } from "@effect/sql-pglite";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { readdirSync } from "node:fs";
import { migrations } from "#infrastructure/Database";
import {
  loaderUpTo,
  databaseUpTo,
  describeColumns,
  insertMealPlan,
  insertUser,
  readyMealPlan,
} from "./Helpers.ts";

const migrationsDirectory = new URL("../", import.meta.url);

describe("migrations", () => {
  it("registers every file in src/migrations, numbered without gaps", () => {
    const files = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .map((file) => file.slice(0, -".ts".length))
      .sort();

    for (const name of files) {
      assert.match(name, /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/);
    }
    assert.deepStrictEqual(
      files.map((name) => Number(name.slice(0, 4))),
      files.map((_, index) => index + 1),
    );
    assert.deepStrictEqual(Object.keys(migrations).sort(), files);
  });
});
describe("0003_create_user_roles", () => {
  // Runs the migrations before 0003 first, so users can exist before
  // user_roles does.
  const DatabaseBefore0003 = databaseUpTo(2);

  it.effect(
    "gives users who registered earlier the normalUser role",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const alice = yield* insertUser(sql, "backfill-alice");
        const bob = yield* insertUser(sql, "backfill-bob");
        yield* sql`
          UPDATE users SET created_at = '2026-01-02T03:04:05Z'
          WHERE id = ${alice}
        `;

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(3) });
        assert.deepStrictEqual(applied, [[3, "create_user_roles"]]);

        const roles = yield* sql<{
          readonly subject: string;
          readonly role: string;
          readonly matchesCreatedAt: boolean;
        }>`
          SELECT u.subject, r.role, r.granted_at = u.created_at AS matches_created_at
          FROM user_roles r JOIN users u ON u.id = r.user_id
          WHERE r.user_id IN (${alice}, ${bob})
          ORDER BY u.subject
        `;
        assert.deepStrictEqual(roles, [
          {
            subject: "backfill-alice",
            role: "normalUser",
            matchesCreatedAt: true,
          },
          {
            subject: "backfill-bob",
            role: "normalUser",
            matchesCreatedAt: true,
          },
        ]);
      }).pipe(Effect.provide(DatabaseBefore0003)),
    { timeout: 30_000 },
  );
});

describe("0004_add_user_moderation", () => {
  // Runs the migrations before 0004 first, so roles can exist before
  // user_role_changes does.
  const DatabaseBefore0004 = databaseUpTo(3);

  it.effect(
    "starts the role log with the roles granted so far",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const alice = yield* insertUser(sql, "log-backfill-alice");
        const bob = yield* insertUser(sql, "log-backfill-bob");
        yield* sql`
          INSERT INTO user_roles (user_id, role, granted_at) VALUES
            (${bob}, 'normalUser', '2026-03-04T05:06:07Z'),
            (${alice}, 'superAdmin', '2026-02-03T04:05:06Z'),
            (${alice}, 'normalUser', '2026-01-02T03:04:05Z')
        `;

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(4) });
        assert.deepStrictEqual(applied, [[4, "add_user_moderation"]]);

        // One granted entry per role, by the system, in the order granted.
        const log = yield* sql<{
          readonly subject: string;
          readonly role: string;
          readonly change: string;
          readonly changedBy: string | null;
          readonly matchesGrantedAt: boolean;
        }>`
          SELECT u.subject, c.role, c.change, c.changed_by,
            c.changed_at = r.granted_at AS matches_granted_at
          FROM user_role_changes c
          JOIN users u ON u.id = c.user_id
          JOIN user_roles r ON r.user_id = c.user_id AND r.role = c.role
          WHERE c.user_id IN (${alice}, ${bob})
          ORDER BY c.id
        `;
        const granted = (subject: string, role: string) => ({
          subject,
          role,
          change: "granted",
          changedBy: null,
          matchesGrantedAt: true,
        });
        assert.deepStrictEqual(log, [
          granted("log-backfill-alice", "normalUser"),
          granted("log-backfill-alice", "superAdmin"),
          granted("log-backfill-bob", "normalUser"),
        ]);

        // Existing grants have no granter.
        const granters = yield* sql<{ readonly grantedBy: string | null }>`
          SELECT DISTINCT granted_by FROM user_roles
          WHERE user_id IN (${alice}, ${bob})
        `;
        assert.deepStrictEqual(granters, [{ grantedBy: null }]);
      }).pipe(Effect.provide(DatabaseBefore0004)),
    { timeout: 30_000 },
  );
});

describe("0007_drop_session_id_token", () => {
  // Runs the migrations before 0007 first, so a session can still have an
  // id_token before the column is dropped.
  const DatabaseBefore0007 = databaseUpTo(6);

  it.effect(
    "drops id_token and keeps the sessions",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO auth_sessions (id_hash, user_id, id_token, claims, expires_at)
          VALUES (${new Uint8Array(32)}, 'drop-token-user', 'token', '{"a":1}', '2030-01-01T00:00:00Z')
        `;

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(7) });
        assert.deepStrictEqual(applied, [[7, "drop_session_id_token"]]);

        const columns = yield* describeColumns(sql, "auth_sessions");
        assert.isFalse(
          columns.some((c) => c.startsWith("auth_sessions.id_token")),
        );
        const sessions = yield* sql<{
          readonly userId: string;
          readonly claims: unknown;
        }>`
          SELECT user_id, claims FROM auth_sessions
          WHERE user_id = 'drop-token-user'
        `;
        assert.deepStrictEqual(sessions, [
          { userId: "drop-token-user", claims: { a: 1 } },
        ]);
      }).pipe(Effect.provide(DatabaseBefore0007)),
    { timeout: 30_000 },
  );
});

describe("0012_allow_blog_editor_roles", () => {
  // Runs the migrations before 0012 first, so roles and their log exist
  // before the checks are replaced.
  const DatabaseBefore0012 = databaseUpTo(11);

  it.effect(
    "keeps the existing roles and validates the replaced checks",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const alice = yield* insertUser(sql, "blog-editor-alice");
        yield* sql`
          INSERT INTO user_roles (user_id, role) VALUES
            (${alice}, 'normalUser'),
            (${alice}, 'superAdmin')
        `;
        yield* sql`
          INSERT INTO user_role_changes (user_id, role, change, changed_at)
          VALUES (${alice}, 'superAdmin', 'granted', now())
        `;
        // Not allowed before 0012.
        const before = yield* sql`
          INSERT INTO user_roles (user_id, role)
          VALUES (${alice}, 'blogEditor:rust-notes')
        `.pipe(Effect.flip);
        assert.strictEqual(before.reason._tag, "ConstraintError");

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(12) });
        assert.deepStrictEqual(applied, [[12, "allow_blog_editor_roles"]]);

        const roles = yield* sql<{ readonly role: string }>`
          SELECT role FROM user_roles WHERE user_id = ${alice} ORDER BY role
        `;
        assert.deepStrictEqual(
          roles.map((row) => row.role),
          ["normalUser", "superAdmin"],
        );

        // Same names, and validated (not NOT VALID) on both tables.
        const checks = yield* sql<{
          readonly conname: string;
          readonly convalidated: boolean;
        }>`
          SELECT conname, convalidated FROM pg_constraint
          WHERE conname IN (
            'user_roles_role_check', 'user_role_changes_role_check'
          )
          ORDER BY conname
        `;
        assert.deepStrictEqual(checks, [
          { conname: "user_role_changes_role_check", convalidated: true },
          { conname: "user_roles_role_check", convalidated: true },
        ]);

        yield* sql`
          INSERT INTO user_roles (user_id, role)
          VALUES (${alice}, 'blogEditor:rust-notes')
        `;
      }).pipe(Effect.provide(DatabaseBefore0012)),
    { timeout: 30_000 },
  );
});

describe("0015_audit_admin_insights", () => {
  // Runs the migrations before 0015 first, so the log has rows before the
  // check is replaced and the indexes are built.
  const DatabaseBefore0015 = databaseUpTo(14);

  it.effect(
    "keeps the existing entries and validates the replaced check",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO audit_log (at, action, actor_id, target_id, detail)
          VALUES
            ('2026-01-01T00:00:00Z', 'login', gen_random_uuid(), NULL, NULL),
            ('2026-01-02T00:00:00Z', 'role_granted', NULL, gen_random_uuid(), 'admin')
        `;
        // Not allowed before 0015.
        const before = yield* sql`
          INSERT INTO audit_log (at, action, detail)
          VALUES ('2026-01-03T00:00:00Z', 'outbox_retried', 'mail')
        `.pipe(Effect.flip);
        assert.strictEqual(before.reason._tag, "ConstraintError");

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(15) });
        assert.deepStrictEqual(applied, [[15, "audit_admin_insights"]]);

        const actions = yield* sql<{ readonly action: string }>`
          SELECT action FROM audit_log ORDER BY id
        `;
        assert.deepStrictEqual(
          actions.map((row) => row.action),
          ["login", "role_granted"],
        );

        // Same name, and validated (not NOT VALID).
        const checks = yield* sql<{
          readonly conname: string;
          readonly convalidated: boolean;
        }>`
          SELECT conname, convalidated FROM pg_constraint
          WHERE conrelid = 'audit_log'::regclass
            AND conname = 'audit_log_action_check'
        `;
        assert.deepStrictEqual(checks, [
          { conname: "audit_log_action_check", convalidated: true },
        ]);

        yield* sql`
          INSERT INTO audit_log (at, action, actor_id, detail)
          VALUES
            ('2026-01-03T00:00:00Z', 'outbox_retried', gen_random_uuid(), 'mail'),
            ('2026-01-04T00:00:00Z', 'contact_message_deleted', gen_random_uuid(), NULL)
        `;
      }).pipe(Effect.provide(DatabaseBefore0015)),
    { timeout: 30_000 },
  );
});

describe("0016_audit_content_changes", () => {
  // Runs the migrations up to 0015 first, so the log has rows (including
  // actions added by 0015) before the check is replaced.
  const DatabaseBefore0016 = databaseUpTo(15);

  it.effect(
    "keeps the existing entries and validates the replaced check",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO audit_log (at, action, actor_id, target_id, detail)
          VALUES
            ('2026-01-01T00:00:00Z', 'login', gen_random_uuid(), NULL, NULL),
            ('2026-01-02T00:00:00Z', 'outbox_retried', gen_random_uuid(), NULL, 'mail')
        `;
        // Not allowed before 0016.
        const before = yield* sql`
          INSERT INTO audit_log (at, action, detail)
          VALUES ('2026-01-03T00:00:00Z', 'blog_created', 'rust-notes')
        `.pipe(Effect.flip);
        assert.strictEqual(before.reason._tag, "ConstraintError");

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(16) });
        assert.deepStrictEqual(applied, [[16, "audit_content_changes"]]);

        const actions = yield* sql<{ readonly action: string }>`
          SELECT action FROM audit_log ORDER BY id
        `;
        assert.deepStrictEqual(
          actions.map((row) => row.action),
          ["login", "outbox_retried"],
        );

        // Same name, and validated (not NOT VALID).
        const checks = yield* sql<{
          readonly conname: string;
          readonly convalidated: boolean;
        }>`
          SELECT conname, convalidated FROM pg_constraint
          WHERE conrelid = 'audit_log'::regclass
            AND conname = 'audit_log_action_check'
        `;
        assert.deepStrictEqual(checks, [
          { conname: "audit_log_action_check", convalidated: true },
        ]);

        yield* sql`
          INSERT INTO audit_log (at, action, actor_id, detail)
          VALUES
            ('2026-01-03T00:00:00Z', 'blog_created', gen_random_uuid(), 'rust-notes'),
            ('2026-01-04T00:00:00Z', 'blog_updated', gen_random_uuid(), 'rust-notes'),
            ('2026-01-05T00:00:00Z', 'post_deleted', gen_random_uuid(), gen_random_uuid()::text),
            ('2026-01-06T00:00:00Z', 'project_created', gen_random_uuid(), 'website'),
            ('2026-01-07T00:00:00Z', 'project_updated', gen_random_uuid(), 'website'),
            ('2026-01-08T00:00:00Z', 'project_deleted', gen_random_uuid(), 'website')
        `;
      }).pipe(Effect.provide(DatabaseBefore0016)),
    { timeout: 30_000 },
  );
});

describe("0017_create_blog_requests", () => {
  // Runs the migrations up to 0016 first, so the log has rows (including
  // actions added by 0016) before the check is replaced.
  const DatabaseBefore0017 = databaseUpTo(16);

  it.effect(
    "keeps the existing entries and validates the replaced check",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO audit_log (at, action, actor_id, target_id, detail)
          VALUES
            ('2026-01-01T00:00:00Z', 'login', gen_random_uuid(), NULL, NULL),
            ('2026-01-02T00:00:00Z', 'blog_created', gen_random_uuid(), NULL, 'rust-notes')
        `;
        // Not allowed before 0017.
        const before = yield* sql`
          INSERT INTO audit_log (at, action, detail)
          VALUES ('2026-01-03T00:00:00Z', 'blog_request_approved', 'rust-notes')
        `.pipe(Effect.flip);
        assert.strictEqual(before.reason._tag, "ConstraintError");

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(17) });
        assert.deepStrictEqual(applied, [[17, "create_blog_requests"]]);

        const actions = yield* sql<{ readonly action: string }>`
          SELECT action FROM audit_log ORDER BY id
        `;
        assert.deepStrictEqual(
          actions.map((row) => row.action),
          ["login", "blog_created"],
        );

        // Same name, and validated (not NOT VALID).
        const checks = yield* sql<{
          readonly conname: string;
          readonly convalidated: boolean;
        }>`
          SELECT conname, convalidated FROM pg_constraint
          WHERE conrelid = 'audit_log'::regclass
            AND conname = 'audit_log_action_check'
        `;
        assert.deepStrictEqual(checks, [
          { conname: "audit_log_action_check", convalidated: true },
        ]);

        yield* sql`
          INSERT INTO audit_log (at, action, actor_id, target_id, detail)
          VALUES
            ('2026-01-03T00:00:00Z', 'blog_request_approved', gen_random_uuid(), gen_random_uuid(), 'rust-notes'),
            ('2026-01-04T00:00:00Z', 'blog_request_rejected', gen_random_uuid(), gen_random_uuid(), NULL)
        `;
      }).pipe(Effect.provide(DatabaseBefore0017)),
    { timeout: 30_000 },
  );
});

describe("0018_create_categories", () => {
  // Runs the migrations up to 0017 first, so subblogs, posts and audit
  // entries exist before the new columns are added.
  const DatabaseBefore0018 = databaseUpTo(17);

  const paragraph = (...texts: ReadonlyArray<string>) => ({
    type: "paragraph",
    content: texts.map((text) => ({ type: "text", text })),
  });
  const documents = [
    // Empty: no text nodes at all.
    { type: "doc", content: [{ type: "paragraph" }] },
    // Whitespace around and between words, tabs and newlines, an empty and
    // a whitespace-only text node.
    {
      type: "doc",
      content: [
        paragraph("  Hello,  world ", "", "   "),
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Two\twords\nand more" }],
        },
      ],
    },
    // Nested lists and marks; a code block counts too.
    {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                paragraph("one"),
                {
                  type: "bulletList",
                  content: [
                    { type: "listItem", content: [paragraph("two three")] },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " text" },
          ],
        },
        { type: "codeBlock", content: [{ type: "text", text: "let x = 1;" }] },
      ],
    },
  ];

  it.effect(
    "backfills main categories and word counts and widens the audit check",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const [blog] = yield* sql<{ readonly id: string }>`
          INSERT INTO blogs (id, slug, title, description, created_at, updated_at)
          VALUES (gen_random_uuid(), 'old-blog', 'Old', '', now(), now())
          RETURNING id
        `;
        for (const [index, content] of documents.entries()) {
          yield* sql`
            INSERT INTO blog_posts (
              id, blog_id, slug, title, summary, content, status, created_at,
              updated_at
            )
            VALUES (
              gen_random_uuid(), ${blog.id}, ${`post-${index}`}, 'Title', '',
              ${JSON.stringify(content)}::jsonb, 'draft', now(), now()
            )
          `;
        }
        yield* sql`
          INSERT INTO audit_log (at, action, detail)
          VALUES ('2026-01-01T00:00:00Z', 'blog_request_approved', 'old-blog')
        `;
        // Not allowed before 0018.
        const before = yield* sql`
          INSERT INTO audit_log (at, action, detail)
          VALUES ('2026-01-02T00:00:00Z', 'category_created', 'rust')
        `.pipe(Effect.flip);
        assert.strictEqual(before.reason._tag, "ConstraintError");

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(18) });
        assert.deepStrictEqual(applied, [[18, "create_categories"]]);

        const blogs = yield* sql<{ readonly slug: string }>`
          SELECT c.slug FROM blogs b JOIN categories c ON c.id = b.main_category_id
        `;
        assert.deepStrictEqual(blogs, [{ slug: "miscellaneous" }]);

        // The stored count is exactly what BlogRepository computed per query.
        const posts = yield* sql<{
          readonly slug: string;
          readonly category: string;
          readonly wordCount: number;
          readonly computed: number;
        }>`
          SELECT p.slug, c.slug AS category, p.word_count,
            (SELECT count(*)::int
               FROM jsonb_path_query(p.content, 'strict $.**.text') AS t(text),
                    regexp_split_to_table(t.text #>> '{}', '\\s+') AS w(word)
              WHERE w.word <> '') AS computed
          FROM blog_posts p JOIN categories c ON c.id = p.main_category_id
          ORDER BY p.slug
        `;
        assert.deepStrictEqual(posts, [
          {
            slug: "post-0",
            category: "miscellaneous",
            wordCount: 0,
            computed: 0,
          },
          {
            slug: "post-1",
            category: "miscellaneous",
            wordCount: 6,
            computed: 6,
          },
          {
            slug: "post-2",
            category: "miscellaneous",
            wordCount: 9,
            computed: 9,
          },
        ]);

        const columns = yield* sql<{
          readonly tableName: string;
          readonly columnName: string;
          readonly isNullable: string;
          readonly columnDefault: string | null;
        }>`
          SELECT table_name, column_name, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND column_name IN ('main_category_id', 'word_count')
          ORDER BY table_name, column_name
        `;
        assert.deepStrictEqual(columns, [
          {
            tableName: "blog_posts",
            columnName: "main_category_id",
            isNullable: "NO",
            columnDefault: null,
          },
          {
            tableName: "blog_posts",
            columnName: "word_count",
            isNullable: "NO",
            columnDefault: "0",
          },
          {
            tableName: "blogs",
            columnName: "main_category_id",
            isNullable: "NO",
            columnDefault: null,
          },
        ]);

        const actions = yield* sql<{ readonly action: string }>`
          SELECT action FROM audit_log ORDER BY id
        `;
        assert.deepStrictEqual(
          actions.map((row) => row.action),
          ["blog_request_approved"],
        );
        const checks = yield* sql<{
          readonly conname: string;
          readonly convalidated: boolean;
        }>`
          SELECT conname, convalidated FROM pg_constraint
          WHERE conrelid = 'audit_log'::regclass
            AND conname = 'audit_log_action_check'
        `;
        assert.deepStrictEqual(checks, [
          { conname: "audit_log_action_check", convalidated: true },
        ]);
        yield* sql`
          INSERT INTO audit_log (at, action, actor_id, detail)
          VALUES
            ('2026-01-02T00:00:00Z', 'category_created', gen_random_uuid(), 'rust'),
            ('2026-01-03T00:00:00Z', 'category_renamed', gen_random_uuid(), 'rust-lang'),
            ('2026-01-04T00:00:00Z', 'category_merged', gen_random_uuid(), 'rust-lang'),
            ('2026-01-05T00:00:00Z', 'category_deleted', gen_random_uuid(), 'career')
        `;
      }).pipe(Effect.provide(DatabaseBefore0018)),
    { timeout: 30_000 },
  );
});

describe("0019_create_food_planner", () => {
  // Runs the migrations before 0019 first, so roles and their log exist
  // before the checks are replaced.
  const DatabaseBefore0019 = databaseUpTo(18);

  it.effect(
    "keeps the existing roles and adds foodPlanner to the replaced checks",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const alice = yield* insertUser(sql, "food-planner-alice");
        yield* sql`
          INSERT INTO user_roles (user_id, role) VALUES
            (${alice}, 'normalUser'),
            (${alice}, 'blogEditor:rust-notes')
        `;
        yield* sql`
          INSERT INTO user_role_changes (user_id, role, change, changed_at)
          VALUES (${alice}, 'blogEditor:rust-notes', 'granted', now())
        `;
        // Not allowed before 0019.
        const before = yield* sql`
          INSERT INTO user_roles (user_id, role)
          VALUES (${alice}, 'foodPlanner')
        `.pipe(Effect.flip);
        assert.strictEqual(before.reason._tag, "ConstraintError");

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(19) });
        assert.deepStrictEqual(applied, [[19, "create_food_planner"]]);

        const roles = yield* sql<{ readonly role: string }>`
          SELECT role FROM user_roles WHERE user_id = ${alice} ORDER BY role
        `;
        assert.deepStrictEqual(
          roles.map((row) => row.role),
          ["blogEditor:rust-notes", "normalUser"],
        );

        // Same names, and validated (not NOT VALID) on both tables.
        const checks = yield* sql<{
          readonly conname: string;
          readonly convalidated: boolean;
        }>`
          SELECT conname, convalidated FROM pg_constraint
          WHERE conname IN (
            'user_roles_role_check', 'user_role_changes_role_check'
          )
          ORDER BY conname
        `;
        assert.deepStrictEqual(checks, [
          { conname: "user_role_changes_role_check", convalidated: true },
          { conname: "user_roles_role_check", convalidated: true },
        ]);

        yield* sql`
          INSERT INTO user_roles (user_id, role)
          VALUES (${alice}, 'foodPlanner')
        `;
        yield* sql`
          INSERT INTO user_role_changes (user_id, role, change, changed_at)
          VALUES (${alice}, 'foodPlanner', 'granted', now())
        `;
      }).pipe(Effect.provide(DatabaseBefore0019)),
    { timeout: 30_000 },
  );
});

describe("0020_create_payments", () => {
  // Runs the migrations before 0020 first, so roles and audit entries exist
  // before user_roles.manual is added and the audit check is replaced.
  const DatabaseBefore0020 = databaseUpTo(19);

  it.effect(
    "marks existing roles as manual and keeps the existing audit actions",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const alice = yield* insertUser(sql, "payments-alice");
        yield* sql`
          INSERT INTO user_roles (user_id, role) VALUES
            (${alice}, 'normalUser'),
            (${alice}, 'foodPlanner')
        `;
        yield* sql`
          INSERT INTO audit_log (at, action)
          VALUES ('2026-01-01T00:00:00Z', 'category_deleted')
        `;
        // Not allowed before 0020.
        const before = yield* sql`
          INSERT INTO audit_log (at, action)
          VALUES ('2026-01-01T00:00:00Z', 'payment_refunded')
        `.pipe(Effect.flip);
        assert.strictEqual(before.reason._tag, "ConstraintError");

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(20) });
        assert.deepStrictEqual(applied, [[20, "create_payments"]]);

        // Every role granted before payments existed was granted by someone.
        const roles = yield* sql<{
          readonly role: string;
          readonly manual: boolean;
        }>`
          SELECT role, manual FROM user_roles
          WHERE user_id = ${alice}
          ORDER BY role
        `;
        assert.deepStrictEqual(roles, [
          { role: "foodPlanner", manual: true },
          { role: "normalUser", manual: true },
        ]);

        // Same name, and validated (not NOT VALID).
        const [check] = yield* sql<{ readonly convalidated: boolean }>`
          SELECT convalidated FROM pg_constraint
          WHERE conname = 'audit_log_action_check'
        `;
        assert.isTrue(check.convalidated);
        const actions = yield* sql<{ readonly action: string }>`
          SELECT action FROM audit_log ORDER BY id
        `;
        assert.deepStrictEqual(
          actions.map((row) => row.action),
          ["category_deleted"],
        );
        yield* sql`
          INSERT INTO audit_log (at, action)
          VALUES ('2026-01-01T00:00:00Z', 'payment_refunded')
        `;
      }).pipe(Effect.provide(DatabaseBefore0020)),
    { timeout: 30_000 },
  );
});

describe("0021_create_feature_credits", () => {
  // Runs the migrations before 0021 first, so roles, their log and audit
  // entries exist before the checks are replaced.
  const DatabaseBefore0021 = databaseUpTo(20);

  it.effect(
    "keeps the existing roles and audit actions and adds the new ones",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const alice = yield* insertUser(sql, "credits-alice");
        yield* sql`
          INSERT INTO user_roles (user_id, role, manual) VALUES
            (${alice}, 'normalUser', true),
            (${alice}, 'foodPlanner', false),
            (${alice}, 'blogEditor:rust-notes', true)
        `;
        yield* sql`
          INSERT INTO user_role_changes (user_id, role, change, changed_at)
          VALUES (${alice}, 'foodPlanner', 'granted', now())
        `;
        yield* sql`
          INSERT INTO audit_log (at, action)
          VALUES ('2026-01-01T00:00:00Z', 'payment_product_roles_changed')
        `;
        // Not allowed before 0021.
        const role = yield* sql`
          INSERT INTO user_roles (user_id, role)
          VALUES (${alice}, 'mealPlanBuyer')
        `.pipe(Effect.flip);
        assert.strictEqual(role.reason._tag, "ConstraintError");
        const action = yield* sql`
          INSERT INTO audit_log (at, action)
          VALUES ('2026-01-01T00:00:00Z', 'payment_product_credits_changed')
        `.pipe(Effect.flip);
        assert.strictEqual(action.reason._tag, "ConstraintError");
        const pending = yield* insertMealPlan(sql, { userId: alice });
        const ready = yield* insertMealPlan(sql, {
          userId: alice,
          ...readyMealPlan,
        });

        const applied = yield* PgliteMigrator.run({ loader: loaderUpTo(21) });
        assert.deepStrictEqual(applied, [[21, "create_feature_credits"]]);

        // Plans from before 0021 never started as far as credits go.
        const plans = yield* sql<{
          readonly id: string;
          readonly startedAt: Date | null;
        }>`
          SELECT id, started_at FROM meal_plans
          WHERE id IN (${pending}, ${ready})
          ORDER BY id
        `;
        assert.deepStrictEqual(
          plans,
          [pending, ready].sort().map((id) => ({ id, startedAt: null })),
        );

        const roles = yield* sql<{
          readonly role: string;
          readonly manual: boolean;
        }>`
          SELECT role, manual FROM user_roles
          WHERE user_id = ${alice}
          ORDER BY role
        `;
        assert.deepStrictEqual(roles, [
          { role: "blogEditor:rust-notes", manual: true },
          { role: "foodPlanner", manual: false },
          { role: "normalUser", manual: true },
        ]);
        const actions = yield* sql<{ readonly action: string }>`
          SELECT action FROM audit_log ORDER BY id
        `;
        assert.deepStrictEqual(
          actions.map((row) => row.action),
          ["payment_product_roles_changed"],
        );

        // Same names, and validated (not NOT VALID) on all three tables.
        const checks = yield* sql<{
          readonly conname: string;
          readonly convalidated: boolean;
        }>`
          SELECT conname, convalidated FROM pg_constraint
          WHERE conname IN (
            'user_roles_role_check',
            'user_role_changes_role_check',
            'audit_log_action_check'
          )
          ORDER BY conname
        `;
        assert.deepStrictEqual(checks, [
          { conname: "audit_log_action_check", convalidated: true },
          { conname: "user_role_changes_role_check", convalidated: true },
          { conname: "user_roles_role_check", convalidated: true },
        ]);

        yield* sql`
          INSERT INTO user_roles (user_id, role, manual)
          VALUES (${alice}, 'mealPlanBuyer', false)
        `;
        yield* sql`
          INSERT INTO user_role_changes (user_id, role, change, changed_at)
          VALUES (${alice}, 'mealPlanBuyer', 'granted', now())
        `;
        yield* sql`
          INSERT INTO audit_log (at, action)
          VALUES ('2026-01-01T00:00:00Z', 'payment_product_credits_changed')
        `;
      }).pipe(Effect.provide(DatabaseBefore0021)),
    { timeout: 30_000 },
  );
});
