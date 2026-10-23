import { PgliteClient, PgliteMigrator } from "@effect/sql-pglite";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { clientOptions, migrations } from "#infrastructure/Database";

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
export const fixedRoles = [
  "normalUser",
  "admin",
  "superAdmin",
  "foodPlanner",
] as const;

/**
 * user_roles_role_check and user_role_changes_role_check since 0019 (0012
 * plus `foodPlanner`): a fixed role or `blogEditor:<slug>`, as Postgres
 * prints the definition.
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

/** The id of a category, a preset of 0018 or one from {@link insertCategory}. */
export const categoryId = (sql: SqlClient.SqlClient, slug: string) =>
  sql`(SELECT id FROM categories WHERE slug = ${slug})`;

/** Inserts a category and returns its id. */
export const insertCategory = (
  sql: SqlClient.SqlClient,
  slug: string,
  name: string = slug,
  createdBy: string | null = null,
) =>
  sql<{ readonly id: string }>`
    INSERT INTO categories (id, slug, name, created_at, created_by)
    VALUES (gen_random_uuid(), ${slug}, ${name}, now(), ${createdBy})
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));

/**
 * Inserts a subblog and returns its id. Its main category is
 * `miscellaneous` unless `mainCategoryId` names another.
 */
export const insertBlog = (
  sql: SqlClient.SqlClient,
  slug: string,
  createdBy: string | null = null,
  mainCategoryId?: string,
) =>
  sql<{ readonly id: string }>`
    INSERT INTO blogs (
      id, slug, title, description, created_at, created_by, updated_at,
      main_category_id
    )
    VALUES (
      gen_random_uuid(), ${slug}, 'Title', '', now(), ${createdBy}, now(),
      ${mainCategoryId === undefined ? categoryId(sql, "miscellaneous") : sql`${mainCategoryId}::uuid`}
    )
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

/**
 * Inserts a post, a draft with an empty document by default. Its main
 * category is `miscellaneous` unless `mainCategoryId` names another. Its
 * word count is set by the trigger of 0018.
 */
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
    readonly mainCategoryId?: string;
  },
) => {
  const content = post.content ?? {
    type: "doc",
    content: [{ type: "paragraph" }],
  };
  return sql<{ readonly id: string }>`
    INSERT INTO blog_posts (
      id, blog_id, slug, title, summary, tags, cover_media_id, content,
      status, published_at, author_id, updated_by, created_at, updated_at,
      version, main_category_id
    )
    VALUES (
      gen_random_uuid(), ${post.blogId}, ${post.slug}, ${post.title ?? "Title"},
      ${post.summary ?? ""}, ${post.tags ?? []}::text[],
      ${post.coverMediaId ?? null},
      ${JSON.stringify(content)}::jsonb,
      ${post.status ?? "draft"}, ${post.publishedAt ?? null}::timestamptz,
      ${post.authorId ?? null}, ${post.authorId ?? null},
      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ${post.version ?? 1},
      ${post.mainCategoryId === undefined ? categoryId(sql, "miscellaneous") : sql`${post.mainCategoryId}::uuid`}
    )
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));
};

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

/** Inserts a blog request, a pending one by default, and returns its id. */
export const insertBlogRequest = (
  sql: SqlClient.SqlClient,
  request: {
    readonly requesterId: string;
    readonly title?: string;
    readonly description?: string;
    readonly status?: string;
    readonly createdAt?: string;
    readonly decidedAt?: string | null;
    readonly decidedBy?: string | null;
    readonly reason?: string | null;
    readonly blogId?: string | null;
  },
) =>
  sql<{ readonly id: string }>`
    INSERT INTO blog_requests (
      id, requester_id, title, description, status, created_at, decided_at,
      decided_by, reason, blog_id
    )
    VALUES (
      gen_random_uuid(), ${request.requesterId}, ${request.title ?? "Title"},
      ${request.description ?? ""}, ${request.status ?? "pending"},
      ${request.createdAt ?? "2026-01-01T00:00:00Z"}::timestamptz,
      ${request.decidedAt ?? null}::timestamptz, ${request.decidedBy ?? null},
      ${request.reason ?? null}, ${request.blogId ?? null}
    )
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));

/** Inserts a food item, a German Open Food Facts product by default. */
export const insertFoodItem = (
  sql: SqlClient.SqlClient,
  item: {
    readonly sourceRef: string;
    readonly country?: string;
    readonly source?: string;
    readonly name?: string;
    readonly brand?: string | null;
    readonly quantityAmount?: number | string | null;
    readonly quantityUnit?: string | null;
    readonly vegetarian?: boolean | null;
    readonly vegan?: boolean | null;
    readonly categories?: ReadonlyArray<string | null>;
    readonly ingredients?: ReadonlyArray<string | null>;
    readonly allergens?: ReadonlyArray<string | null>;
  },
) =>
  sql<{ readonly id: string }>`
    INSERT INTO food_items (
      id, country, source, source_ref, name, brand, quantity_amount,
      quantity_unit, vegetarian, vegan, categories, ingredients, allergens,
      created_at, updated_at
    )
    VALUES (
      gen_random_uuid(), ${item.country ?? "DE"},
      ${item.source ?? "openFoodFacts"}, ${item.sourceRef},
      ${item.name ?? "Name"}, ${item.brand ?? null},
      ${item.quantityAmount ?? null}::numeric, ${item.quantityUnit ?? null},
      ${item.vegetarian ?? null}::boolean, ${item.vegan ?? null}::boolean,
      ${item.categories ?? []}::text[], ${item.ingredients ?? []}::text[],
      ${item.allergens ?? []}::text[],
      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
    )
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));

/** Inserts a price of a food item, an Open Prices price in EUR by default. */
export const insertFoodPrice = (
  sql: SqlClient.SqlClient,
  price: {
    readonly foodItemId: string;
    readonly sourceRef: string;
    readonly source?: string;
    readonly amount?: number | string;
    readonly currency?: string;
    readonly observedOn?: string;
    readonly accuracy?: number;
    readonly discounted?: boolean;
    readonly whereText?: string;
  },
) =>
  sql<{ readonly id: string }>`
    INSERT INTO food_prices (
      food_item_id, source, source_ref, amount, currency, observed_on,
      accuracy, discounted, where_text, created_at
    )
    VALUES (
      ${price.foodItemId}, ${price.source ?? "openPrices"}, ${price.sourceRef},
      ${price.amount ?? 1.99}::numeric, ${price.currency ?? "EUR"},
      ${price.observedOn ?? "2026-09-01"}::date, ${price.accuracy ?? 90},
      ${price.discounted ?? false}, ${price.whereText ?? "Store"},
      '2026-01-01T00:00:00Z'
    )
    RETURNING id
  `.pipe(Effect.map(([row]) => String(row.id)));

/** Inserts an import job, a queued German Open Prices import by default. */
export const insertFoodImport = (
  sql: SqlClient.SqlClient,
  job: {
    readonly country?: string;
    readonly source?: string;
    readonly status?: string;
    readonly requestedBy?: string | null;
    readonly requestedAt?: string;
    readonly startedAt?: string | null;
    readonly finishedAt?: string | null;
    readonly items?: number;
    readonly prices?: number;
    readonly error?: string | null;
  },
) =>
  sql<{ readonly id: string }>`
    INSERT INTO food_imports (
      id, country, source, status, requested_by, requested_at, started_at,
      finished_at, items, prices, error
    )
    VALUES (
      gen_random_uuid(), ${job.country ?? "DE"}, ${job.source ?? "openPrices"},
      ${job.status ?? "queued"}, ${job.requestedBy ?? null},
      ${job.requestedAt ?? "2026-01-01T00:00:00Z"}::timestamptz,
      ${job.startedAt ?? null}::timestamptz,
      ${job.finishedAt ?? null}::timestamptz, ${job.items ?? 0},
      ${job.prices ?? 0}, ${job.error ?? null}
    )
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));

/** The columns of a ready meal plan, for {@link insertMealPlan}. */
export const readyMealPlan = {
  status: "ready",
  plan: { days: [], shoppingList: [], notes: [] },
  totalCost: "42.50",
  estimatedShare: 20,
  accuracy: 70,
  model: "model-1",
  finishedAt: "2026-01-01T00:01:00Z",
} as const;

/** Inserts a meal plan, a pending German one by default. */
export const insertMealPlan = (
  sql: SqlClient.SqlClient,
  mealPlan: {
    readonly userId: string;
    readonly country?: string;
    readonly currency?: string;
    readonly status?: string;
    readonly request?: unknown;
    readonly plan?: unknown;
    readonly totalCost?: number | string | null;
    readonly cheapestTotal?: number | string | null;
    readonly estimatedShare?: number | null;
    readonly accuracy?: number | null;
    readonly model?: string | null;
    readonly failureReason?: string | null;
    readonly createdAt?: string;
    readonly finishedAt?: string | null;
  },
) =>
  sql<{ readonly id: string }>`
    INSERT INTO meal_plans (
      id, user_id, country, currency, status, request, plan, total_cost,
      cheapest_total, estimated_share, accuracy, model, failure_reason,
      created_at, finished_at
    )
    VALUES (
      gen_random_uuid(), ${mealPlan.userId}, ${mealPlan.country ?? "DE"},
      ${mealPlan.currency ?? "EUR"}, ${mealPlan.status ?? "pending"},
      ${JSON.stringify(mealPlan.request ?? { days: 7 })}::jsonb,
      ${mealPlan.plan == null ? null : JSON.stringify(mealPlan.plan)}::jsonb,
      ${mealPlan.totalCost ?? null}::numeric,
      ${mealPlan.cheapestTotal ?? null}::numeric,
      ${mealPlan.estimatedShare ?? null}::smallint,
      ${mealPlan.accuracy ?? null}::smallint, ${mealPlan.model ?? null},
      ${mealPlan.failureReason ?? null},
      ${mealPlan.createdAt ?? "2026-01-01T00:00:00Z"}::timestamptz,
      ${mealPlan.finishedAt ?? null}::timestamptz
    )
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));

/** Inserts a product, a disabled standard test-mode product by default. */
export const insertPaymentProduct = (
  sql: SqlClient.SqlClient,
  product: {
    readonly id: string;
    readonly name?: string;
    readonly description?: string | null;
    readonly active?: boolean;
    readonly livemode?: boolean;
    readonly enabled?: boolean;
    readonly kind?: string;
  },
) =>
  sql`
    INSERT INTO payment_products (
      id, name, description, active, livemode, enabled, kind, updated_at
    )
    VALUES (
      ${product.id}, ${product.name ?? "Product"},
      ${product.description ?? null}, ${product.active ?? true},
      ${product.livemode ?? false}, ${product.enabled ?? false},
      ${product.kind ?? "standard"}, '2026-01-01T00:00:00Z'
    )
  `;

/** Inserts a price, a one-time price of 500 eur by default. */
export const insertPaymentPrice = (
  sql: SqlClient.SqlClient,
  price: {
    readonly id: string;
    readonly productId: string;
    readonly active?: boolean;
    readonly currency?: string;
    readonly unitAmount?: number | null;
    readonly recurringInterval?: string | null;
    readonly recurringIntervalCount?: number | null;
    readonly livemode?: boolean;
  },
) =>
  sql`
    INSERT INTO payment_prices (
      id, product_id, active, currency, unit_amount, recurring_interval,
      recurring_interval_count, livemode, updated_at
    )
    VALUES (
      ${price.id}, ${price.productId}, ${price.active ?? true},
      ${price.currency ?? "eur"},
      ${price.unitAmount === undefined ? 500 : price.unitAmount}::integer,
      ${price.recurringInterval ?? null},
      ${price.recurringIntervalCount ?? null}::integer,
      ${price.livemode ?? false}, '2026-01-01T00:00:00Z'
    )
  `;

/** Inserts a subscription, an active test-mode one by default. */
export const insertPaymentSubscription = (
  sql: SqlClient.SqlClient,
  subscription: {
    readonly id: string;
    readonly userId?: string | null;
    readonly productId?: string | null;
    readonly status?: string;
  },
) =>
  sql`
    INSERT INTO payment_subscriptions (
      id, user_id, customer_id, product_id, price_id, status,
      current_period_end, cancel_at_period_end, canceled_at, livemode,
      created_at, updated_at
    )
    VALUES (
      ${subscription.id}, ${subscription.userId ?? null}, 'cus_1',
      ${subscription.productId ?? null}, NULL,
      ${subscription.status ?? "active"}, '2026-02-01T00:00:00Z', false, NULL,
      false, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
    )
  `;

/**
 * Inserts a payment, a paid test-mode purchase of 500 eur from a Checkout
 * session by default, and returns its id.
 */
export const insertPayment = (
  sql: SqlClient.SqlClient,
  payment: {
    readonly userId?: string | null;
    readonly kind?: string;
    readonly productId?: string | null;
    readonly checkoutSessionId?: string | null;
    readonly invoiceId?: string | null;
    readonly subscriptionId?: string | null;
    readonly paymentIntentId?: string | null;
    readonly amount?: number;
    readonly amountRefunded?: number;
    readonly currency?: string;
    readonly status?: string;
  },
) =>
  sql<{ readonly id: string }>`
    INSERT INTO payments (
      id, user_id, kind, product_id, checkout_session_id, invoice_id,
      subscription_id, payment_intent_id, amount, amount_refunded, currency,
      status, livemode, created_at, updated_at
    )
    VALUES (
      gen_random_uuid(), ${payment.userId ?? null},
      ${payment.kind ?? "purchase"}, ${payment.productId ?? null},
      ${payment.checkoutSessionId === undefined ? sql`'cs_' || gen_random_uuid()` : payment.checkoutSessionId},
      ${payment.invoiceId ?? null}, ${payment.subscriptionId ?? null},
      ${payment.paymentIntentId ?? null}, ${payment.amount ?? 500},
      ${payment.amountRefunded ?? 0}, ${payment.currency ?? "eur"},
      ${payment.status ?? "paid"}, false, '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:00Z'
    )
    RETURNING id
  `.pipe(Effect.map(([row]) => row.id));
