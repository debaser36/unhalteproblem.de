import { PgliteClient, PgliteMigrator } from "@effect/sql-pglite";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { clientOptions, migrations } from "#services/Database";

/** Loads the migrations with ids up to `id`. */
export const loaderUpTo = (id: number) =>
  PgliteMigrator.fromRecord(
    Object.fromEntries(
      Object.entries(migrations).filter(
        ([key]) => Number(key.slice(0, 4)) <= id,
      ),
    ),
  );

/** A fresh database with the migrations up to `id` applied. */
export const databaseUpTo = (id: number) =>
  PgliteMigrator.layer({ loader: loaderUpTo(id) }).pipe(
    Layer.provideMerge(PgliteClient.layer(clientOptions)),
  );

/** `<table>.<column> <type>[ not null][ default …][ generated … as identity]`. */
export const describeColumns = (sql: SqlClient.SqlClient, table: string) =>
  sql<{
    readonly columnName: string;
    readonly dataType: string;
    readonly isNullable: "YES" | "NO";
    readonly columnDefault: string | null;
    readonly identityGeneration: string | null;
  }>`
    SELECT column_name, data_type, is_nullable, column_default,
      identity_generation
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `.pipe(
    Effect.map((columns) =>
      columns.map(
        (c) =>
          `${table}.${c.columnName} ${c.dataType}` +
          (c.isNullable === "NO" ? " not null" : "") +
          (c.columnDefault === null ? "" : ` default ${c.columnDefault}`) +
          (c.identityGeneration === null
            ? ""
            : ` generated ${c.identityGeneration.toLowerCase()} as identity`),
      ),
    ),
  );

/** `<name>: <definition>` of every constraint but NOT NULL, by name. */
export const describeConstraints = (sql: SqlClient.SqlClient, table: string) =>
  sql<{ readonly conname: string; readonly definition: string }>`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = ${table}::regclass AND contype <> 'n'
    ORDER BY conname
  `.pipe(
    Effect.map((constraints) =>
      constraints.map((c) => `${c.conname}: ${c.definition}`),
    ),
  );

/** The definitions of all indexes of a table, by name. */
export const describeIndexes = (sql: SqlClient.SqlClient, table: string) =>
  sql<{ readonly indexdef: string }>`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = ${table}
    ORDER BY indexname
  `.pipe(Effect.map((indexes) => indexes.map((i) => i.indexdef)));

/** The fixed roles of the contract's `Role`, as the role checks list them. */
export const fixedRoles = ["normalUser", "admin", "superAdmin"] as const;

/**
 * user_roles_role_check and user_role_changes_role_check since 0012: a fixed
 * role or `blogEditor:<slug>`, as Postgres prints the definition.
 */
export const roleCheck =
  `CHECK (((role = ANY (ARRAY[${fixedRoles.map((role) => `'${role}'::text`).join(", ")}]))` +
  ` OR ((role ~ '^blogEditor:[a-z0-9]+(-[a-z0-9]+)*$'::text)` +
  ` AND (char_length(role) <= 75))))`;

/** Roles of the form `blogEditor:<slug>` that the role checks accept. */
export const validBlogEditorRoles = [
  "blogEditor:rust-notes",
  "blogEditor:a",
  "blogEditor:2026",
  "blogEditor:a1-b2-c3",
  // The longest slug, 64 characters.
  `blogEditor:${"a".repeat(64)}`,
];

/** Malformed `blogEditor:` roles that the role checks reject. */
export const invalidBlogEditorRoles = [
  // No slug.
  "blogEditor:",
  // Not lowercase ASCII letters and digits.
  "blogEditor:Rust",
  "blogEditor:a_b",
  "blogEditor:a b",
  "blogEditor:ä",
  // Hyphens only between groups.
  "blogEditor:-a",
  "blogEditor:a-",
  "blogEditor:a--b",
  // The prefix is case sensitive and anchored.
  "blogeditor:x",
  "BlogEditor:x",
  " blogEditor:x",
  "xblogEditor:x",
  "blogEditor:x\n",
  // A slug of 65 characters.
  `blogEditor:${"a".repeat(65)}`,
];

export const insertUser = (sql: SqlClient.SqlClient, subject: string) =>
  sql<{ readonly id: string }>`
    INSERT INTO users (id, subject, created_at, updated_at, last_login_at)
    VALUES (gen_random_uuid(), ${subject}, now(), now(), now())
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));

/** Inserts a subblog and returns its id. */
export const insertBlog = (
  sql: SqlClient.SqlClient,
  slug: string,
  createdBy: string | null = null,
) =>
  sql<{ readonly id: string }>`
    INSERT INTO blogs
      (id, slug, title, description, created_at, created_by, updated_at)
    VALUES (gen_random_uuid(), ${slug}, 'Title', '', now(), ${createdBy}, now())
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));

/** Inserts a 4-byte PNG "image" with a matching size and digest. */
export const insertMedia = (
  sql: SqlClient.SqlClient,
  scope: string,
  uploadedBy: string | null = null,
) =>
  sql<{ readonly id: string }>`
    INSERT INTO media
      (id, content_type, data, byte_size, sha256, scope, uploaded_by, uploaded_at)
    SELECT gen_random_uuid(), 'image/png', d, octet_length(d), sha256(d),
      ${scope}, ${uploadedBy}, now()
    FROM (SELECT '\\x89504e47'::bytea AS d) AS upload
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));

/** Inserts a post, a draft with an empty document by default. */
export const insertPost = (
  sql: SqlClient.SqlClient,
  post: {
    readonly blogId: string;
    readonly slug: string;
    readonly title?: string;
    readonly summary?: string;
    readonly tags?: ReadonlyArray<string | null>;
    readonly coverMediaId?: string;
    readonly content?: unknown;
    readonly status?: string;
    readonly publishedAt?: string;
    readonly authorId?: string;
    readonly version?: number;
  },
) =>
  sql<{ readonly id: string }>`
    INSERT INTO blog_posts (
      id, blog_id, slug, title, summary, tags, cover_media_id, content,
      status, published_at, author_id, updated_by, created_at, updated_at,
      version
    )
    VALUES (
      gen_random_uuid(), ${post.blogId}, ${post.slug}, ${post.title ?? "Title"},
      ${post.summary ?? ""}, ${post.tags ?? []}::text[],
      ${post.coverMediaId ?? null},
      ${JSON.stringify(post.content ?? { type: "doc", content: [{ type: "paragraph" }] })}::jsonb,
      ${post.status ?? "draft"}, ${post.publishedAt ?? null}::timestamptz,
      ${post.authorId ?? null}, ${post.authorId ?? null},
      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ${post.version ?? 1}
    )
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));

/** Inserts a project, an unpublished one with an empty document by default. */
export const insertProject = (
  sql: SqlClient.SqlClient,
  project: {
    readonly slug: string;
    readonly title?: string;
    readonly summary?: string;
    readonly tags?: ReadonlyArray<string | null>;
    readonly status?: string;
    readonly featured?: boolean;
    readonly position?: number;
    readonly repoUrl?: string | null;
    readonly liveUrl?: string | null;
    readonly coverMediaId?: string;
    readonly content?: unknown;
    readonly published?: boolean;
    readonly createdBy?: string;
    readonly updatedAt?: string;
    readonly version?: number;
  },
) =>
  sql<{ readonly id: string }>`
    INSERT INTO projects (
      id, slug, title, summary, tags, status, featured, position, repo_url,
      live_url, cover_media_id, content, published, created_by, updated_by,
      created_at, updated_at, version
    )
    VALUES (
      gen_random_uuid(), ${project.slug}, ${project.title ?? "Title"},
      ${project.summary ?? ""}, ${project.tags ?? []}::text[],
      ${project.status ?? "active"}, ${project.featured ?? false},
      ${project.position ?? 0}, ${project.repoUrl ?? null},
      ${project.liveUrl ?? null}, ${project.coverMediaId ?? null},
      ${JSON.stringify(project.content ?? { type: "doc", content: [{ type: "paragraph" }] })}::jsonb,
      ${project.published ?? false}, ${project.createdBy ?? null},
      ${project.createdBy ?? null}, '2026-01-01T00:00:00Z',
      ${project.updatedAt ?? "2026-01-01T00:00:00Z"}::timestamptz,
      ${project.version ?? 1}
    )
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));
