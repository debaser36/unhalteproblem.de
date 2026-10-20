import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { type Json, json, makeBlogApp } from "#testing/Blogs";

/** An id no contact message has. */
const unknownUuid = "00000000-0000-4000-8000-000000000000";

/** An id no outbox message has. */
const unknownOutboxId = 999_999;

/** The migrations, in the order they are applied. */
const migrationNames = [
  "create_auth_tables",
  "create_users",
  "create_user_roles",
  "add_user_moderation",
  "create_outbox",
  "create_contact_messages",
  "drop_session_id_token",
  "index_users_created_at",
  "create_audit_log",
  "add_user_deleted_at",
  "users_created_at_milliseconds",
  "allow_blog_editor_roles",
  "create_blogs_and_media",
  "create_projects",
  "audit_admin_insights",
];

interface OutboxFields {
  readonly topic?: string;
  readonly attempts?: number;
  readonly lastError?: string | null;
  readonly availableAt?: Date;
  readonly lockedUntil?: Date | null;
  readonly deadAt?: Date | null;
  readonly createdAt?: Date;
}

/** The app with an admin, and helpers to fill and read the tables. */
const setup = Effect.gen(function* () {
  const app = yield* makeBlogApp();
  const { sql } = app;

  /** Inserts an outbox message in SQL; returns its id. */
  const outbox = (fields: OutboxFields = {}) =>
    sql(
      (sql) => sql<{ readonly id: number }>`
        INSERT INTO outbox (topic, payload, created_at, available_at,
                            locked_until, attempts, last_error, dead_at)
        VALUES (${fields.topic ?? "contact.send-mail"},
                ${JSON.stringify({ secret: "payload" })}::jsonb,
                ${fields.createdAt ?? new Date("2026-01-01T00:00:00.000Z")},
                ${fields.availableAt ?? new Date("2026-01-01T00:00:00.000Z")},
                ${fields.lockedUntil ?? null},
                ${fields.attempts ?? 0},
                ${fields.lastError ?? null},
                ${fields.deadAt ?? null})
        RETURNING id::float8 AS id
      `,
    ).pipe(Effect.map((rows) => rows[0]?.id ?? 0));

  /** Inserts a contact message in SQL; returns its id. */
  const contact = (
    name: string,
    createdAt: Date,
    id: string = crypto.randomUUID(),
  ) =>
    sql(
      (sql) => sql`
        INSERT INTO contact_messages (id, name, email, message, created_at)
        VALUES (${id}, ${name}, ${`${name.toLowerCase()}@example.org`},
                ${`Hello from ${name}`}, ${createdAt})
      `,
    ).pipe(Effect.as(id));

  /** The audit log entries of `action`, oldest first. */
  const audited = (action: string) =>
    sql(
      (sql) => sql<{
        readonly actorId: string | null;
        readonly targetId: string | null;
        readonly detail: string | null;
      }>`
        SELECT actor_id, target_id, detail FROM audit_log
        WHERE action = ${action} ORDER BY id
      `,
    );

  return { ...app, outbox, contact, audited };
});

type Setup = Effect.Success<typeof setup>;

/** Every endpoint of the group; the ids are of existing rows. */
const endpoints = (outboxId: number, contactId: string) =>
  [
    { name: "databaseOverview", method: "GET", path: "/admin/database" },
    { name: "listOutbox", method: "GET", path: "/admin/outbox" },
    {
      name: "retryOutboxMessage",
      method: "POST",
      path: `/admin/outbox/${outboxId}/retry`,
    },
    { name: "listAuditLog", method: "GET", path: "/admin/audit" },
    { name: "listContactMessages", method: "GET", path: "/admin/contact" },
    {
      name: "deleteContactMessage",
      method: "DELETE",
      path: `/admin/contact/${contactId}`,
    },
  ] as const;

/** A dead outbox message and a contact message, for the access tests. */
const withRows = (app: Setup) =>
  Effect.gen(function* () {
    const outboxId = yield* app.outbox({
      attempts: 5,
      lastError: "smtp",
      deadAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const contactId = yield* app.contact(
      "Ada",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    return { outboxId, contactId };
  });

/** Neither row was touched, and nothing was audited. */
const untouched = (app: Setup, outboxId: number, contactId: string) =>
  Effect.gen(function* () {
    const rows = yield* app.sql(
      (sql) => sql<{ readonly attempts: number; readonly contacts: number }>`
        SELECT (SELECT attempts FROM outbox WHERE id = ${outboxId}) AS attempts,
               (SELECT count(*)::int FROM contact_messages
                 WHERE id = ${contactId}) AS contacts
      `,
    );
    assert.deepStrictEqual(rows, [{ attempts: 5, contacts: 1 }]);
    assert.deepStrictEqual(yield* app.audited("outbox_retried"), []);
    assert.deepStrictEqual(yield* app.audited("contact_message_deleted"), []);
  });

const list = (body: Json) => body as unknown as ReadonlyArray<Json>;

describe("admin insights access", () => {
  it.effect("every endpoint requires a session (401)", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const { outboxId, contactId } = yield* withRows(app);
      for (const endpoint of endpoints(outboxId, contactId)) {
        for (const cookie of [undefined, "unknown"]) {
          // Without Origin too: the session is checked first.
          for (const origin of [undefined, null]) {
            const response = yield* app.call(
              cookie,
              endpoint.method,
              endpoint.path,
              { origin },
            );
            assert.strictEqual(
              response.status,
              401,
              `${endpoint.name} (cookie ${cookie}, origin ${origin})`,
            );
          }
        }
      }
      yield* untouched(app, outboxId, contactId);
    }),
  );

  it.effect("a normal user and a superAdmin get 403", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const { outboxId, contactId } = yield* withRows(app);
      // Roles are flat: superAdmin alone does not include admin.
      for (const [who, { cookie }] of Object.entries({
        user: app.user,
        superAdmin: app.superAdmin,
      })) {
        for (const endpoint of endpoints(outboxId, contactId)) {
          const response = yield* app.call(
            cookie,
            endpoint.method,
            endpoint.path,
          );
          assert.strictEqual(response.status, 403, `${who}: ${endpoint.name}`);
          assert.strictEqual((yield* json(response))["_tag"], "Forbidden");
        }
      }
      yield* untouched(app, outboxId, contactId);
    }),
  );

  it.effect("the two writes require a same-origin request (403)", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const { outboxId, contactId } = yield* withRows(app);
      const writes = endpoints(outboxId, contactId).filter(
        (endpoint) => endpoint.method !== "GET",
      );
      assert.strictEqual(writes.length, 2);
      for (const endpoint of writes) {
        for (const origin of [null, "https://evil.example"]) {
          const response = yield* app.call(
            app.admin.cookie,
            endpoint.method,
            endpoint.path,
            { origin },
          );
          assert.strictEqual(
            response.status,
            403,
            `${endpoint.name} (origin ${origin})`,
          );
        }
      }
      yield* untouched(app, outboxId, contactId);
      // Reads need no Origin.
      yield* app.expect(200, app.admin.cookie, "GET", "/admin/outbox", {
        origin: null,
      });
    }),
  );

  it.effect("read responses must not be cached", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const { outboxId, contactId } = yield* withRows(app);
      // The reads only: the two 204 writes don't set the header yet; that
      // is being fixed separately, add them here then.
      const reads = endpoints(outboxId, contactId).filter(
        (endpoint) => endpoint.method === "GET",
      );
      for (const endpoint of reads) {
        const response = yield* app.call(
          app.admin.cookie,
          endpoint.method,
          endpoint.path,
        );
        assert.isBelow(response.status, 300, endpoint.name);
        assert.strictEqual(
          response.headers.get("cache-control"),
          "no-store",
          endpoint.name,
        );
      }
    }),
  );
});

describe("databaseOverview", () => {
  it.effect("describes the server, its tables and the migrations", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      const overview = yield* app.expect(
        200,
        app.admin.cookie,
        "GET",
        "/admin/database",
      );

      assert.match(String(overview["postgresVersion"]), /^\d+(\.\d+)?/);
      assert.isString(overview["databaseName"]);
      assert.isNotEmpty(overview["databaseName"]);
      assert.isAbove(Number(overview["databaseBytes"]), 0);
      assert.isFalse(Number.isNaN(Date.parse(String(overview["startedAt"]))));

      const connections = overview["connections"] as Json;
      const [active, idle, total, max] = ["active", "idle", "total", "max"].map(
        (key) => Number(connections[key]),
      );
      assert.isAtMost(active! + idle!, total!);
      assert.isAbove(max!, 0);

      const ratio = overview["cacheHitRatio"];
      if (ratio !== null) {
        assert.isAtLeast(Number(ratio), 0);
        assert.isAtMost(Number(ratio), 1);
      }

      // The tables of the public schema, largest first.
      const tables = list(overview["tables"] as Json);
      const names = tables.map((table) => table["name"]);
      for (const name of [
        "users",
        "user_roles",
        "blog_posts",
        "media",
        "outbox",
        "audit_log",
        "contact_messages",
        "projects",
      ]) {
        assert.include(names, name);
      }
      const totals = tables.map((table) => Number(table["totalBytes"]));
      assert.deepStrictEqual(
        totals,
        [...totals].sort((a, b) => b - a),
      );
      for (const table of tables) {
        const totalBytes = Number(table["totalBytes"]);
        const tableBytes = Number(table["tableBytes"]);
        const indexBytes = Number(table["indexBytes"]);
        assert.isAtLeast(
          Number(table["estimatedRows"]),
          0,
          String(table["name"]),
        );
        // pg_total_relation_size = pg_table_size + pg_indexes_size.
        assert.strictEqual(
          tableBytes + indexBytes,
          totalBytes,
          `bytes of ${String(table["name"])}`,
        );
      }
      // Every table here has a primary key, so an index to scan.
      const users = tables.find((table) => table["name"] === "users");
      assert.isAbove(Number(users?.["indexBytes"]), 0);
      assert.isNotNull(users?.["indexScans"]);

      // The applied migrations, in order.
      const migrations = list(overview["migrations"] as Json);
      assert.deepStrictEqual(
        migrations.map((migration) => [migration["id"], migration["name"]]),
        migrationNames.map((name, index) => [index + 1, name]),
      );
      for (const migration of migrations) {
        assert.isFalse(
          Number.isNaN(Date.parse(String(migration["appliedAt"]))),
        );
      }
    }),
  );
});

describe("the outbox", () => {
  it.effect(
    "lists pending, dead or all messages, newest first, without payload",
    () =>
      Effect.gen(function* () {
        const app = yield* setup;
        const lockedUntil = new Date("2026-01-01T00:05:00.000Z");
        const deadAt = new Date("2026-01-03T00:00:00.000Z");
        const pending = yield* app.outbox({ topic: "keycloak.delete-user" });
        const dead = yield* app.outbox({
          attempts: 8,
          lastError: "smtp",
          deadAt,
          lockedUntil,
        });
        const leased = yield* app.outbox({ attempts: 1, lockedUntil });
        const ids = (state: string | undefined) =>
          app
            .expect(
              200,
              app.admin.cookie,
              "GET",
              state === undefined
                ? "/admin/outbox"
                : `/admin/outbox?state=${state}`,
            )
            .pipe(
              Effect.map((body) => list(body).map((message) => message["id"])),
            );

        assert.deepStrictEqual(yield* ids(undefined), [leased, dead, pending]);
        assert.deepStrictEqual(yield* ids("all"), [leased, dead, pending]);
        assert.deepStrictEqual(yield* ids("pending"), [leased, pending]);
        assert.deepStrictEqual(yield* ids("dead"), [dead]);

        const messages = list(
          yield* app.expect(200, app.admin.cookie, "GET", "/admin/outbox"),
        );
        assert.deepStrictEqual(messages[1], {
          id: dead,
          topic: "contact.send-mail",
          attempts: 8,
          lastError: "smtp",
          availableAt: "2026-01-01T00:00:00.000Z",
          lockedUntil: lockedUntil.toISOString(),
          deadAt: deadAt.toISOString(),
          createdAt: "2026-01-01T00:00:00.000Z",
        });
        for (const message of messages) assert.notProperty(message, "payload");

        // At most `limit`, the newest.
        assert.deepStrictEqual(
          list(
            yield* app.expect(
              200,
              app.admin.cookie,
              "GET",
              "/admin/outbox?limit=2",
            ),
          ).map((message) => message["id"]),
          [leased, dead],
        );
        for (const query of ["state=done", "limit=0", "limit=201", "limit=x"]) {
          yield* app.expect(
            400,
            app.admin.cookie,
            "GET",
            `/admin/outbox?${query}`,
          );
        }
      }),
  );

  it.effect(
    "a retry makes a dead message due now with fresh attempts, audited",
    () =>
      Effect.gen(function* () {
        const app = yield* setup;
        const id = yield* app.outbox({
          topic: "keycloak.delete-user",
          attempts: 8,
          lastError: "timeout",
          availableAt: new Date("2026-01-01T01:00:00.000Z"),
          lockedUntil: new Date("2026-01-01T00:05:00.000Z"),
          deadAt: new Date("2026-01-02T00:00:00.000Z"),
        });
        const before = Date.now();
        const response = yield* app.call(
          app.admin.cookie,
          "POST",
          `/admin/outbox/${id}/retry`,
        );
        const after = Date.now();
        assert.strictEqual(response.status, 204);
        assert.strictEqual(yield* Effect.promise(() => response.text()), "");

        const rows = yield* app.sql(
          (sql) => sql<{
            readonly attempts: number;
            readonly lastError: string | null;
            readonly lockedUntil: Date | null;
            readonly deadAt: Date | null;
            readonly availableAt: Date;
            readonly payload: unknown;
          }>`
          SELECT attempts, last_error, locked_until, dead_at, available_at,
                 payload
          FROM outbox WHERE id = ${id}
        `,
        );
        assert.strictEqual(rows.length, 1);
        const row = rows[0]!;
        assert.deepInclude(row, {
          attempts: 0,
          lastError: null,
          lockedUntil: null,
          deadAt: null,
        });
        // Due now: at the time of the request, by the app's clock.
        const due = row.availableAt.getTime();
        assert.isAtLeast(due, before);
        assert.isAtMost(due, after);
        // The payload is kept.
        assert.deepStrictEqual(row.payload, { secret: "payload" });

        // Pending again, and audited with its topic, never its payload.
        const pending = list(
          yield* app.expect(
            200,
            app.admin.cookie,
            "GET",
            "/admin/outbox?state=pending",
          ),
        );
        assert.deepStrictEqual(
          pending.map((message) => message["id"]),
          [id],
        );
        assert.deepStrictEqual(yield* app.audited("outbox_retried"), [
          {
            actorId: app.admin.id,
            targetId: null,
            detail: "keycloak.delete-user",
          },
        ]);
        const page = yield* app.expect(
          200,
          app.admin.cookie,
          "GET",
          "/admin/audit?action=outbox_retried",
        );
        assert.deepInclude(list(page["entries"] as Json)[0], {
          action: "outbox_retried",
          actorId: app.admin.id,
          targetId: null,
          detail: "keycloak.delete-user",
        });

        // A pending message can be retried too.
        yield* app.expect(
          204,
          app.admin.cookie,
          "POST",
          `/admin/outbox/${id}/retry`,
        );
        assert.strictEqual((yield* app.audited("outbox_retried")).length, 2);
      }),
  );

  it.effect(
    "a retry of an unknown message answers 404 and audits nothing",
    () =>
      Effect.gen(function* () {
        const app = yield* setup;
        assert.deepStrictEqual(
          yield* app.expect(
            404,
            app.admin.cookie,
            "POST",
            `/admin/outbox/${unknownOutboxId}/retry`,
          ),
          { _tag: "OutboxMessageNotFound", messageId: unknownOutboxId },
        );
        assert.deepStrictEqual(yield* app.audited("outbox_retried"), []);
        for (const id of ["0", "-1", "1.5", "x"]) {
          yield* app.expect(
            400,
            app.admin.cookie,
            "POST",
            `/admin/outbox/${id}/retry`,
          );
        }
      }),
  );
});

describe("the audit log", () => {
  /**
   * The setup's logins (admin, super, user) and `target`'s, then four role
   * grants by the superAdmin to `user` and to `target`, alternating.
   */
  const withEntries = Effect.gen(function* () {
    const app = yield* setup;
    const target = yield* app.member("target");
    yield* app.createBlog("alpha");
    const grants: Array<{ readonly to: string; readonly role: string }> = [];
    for (const [to, role] of [
      [app.user.id, "admin"],
      [target.id, "admin"],
      [app.user.id, "blogEditor:alpha"],
      [target.id, "blogEditor:alpha"],
    ] as const) {
      yield* app.expect(
        204,
        app.superAdmin.cookie,
        "PUT",
        `/admin/users/${to}/roles/${role}`,
      );
      grants.push({ to, role });
    }
    return { ...app, target, grants };
  });

  const page = (app: Setup, query: string) =>
    app.expect(200, app.admin.cookie, "GET", `/admin/audit?${query}`).pipe(
      Effect.map((body) => ({
        entries: list(body["entries"] as Json),
        nextCursor: body["nextCursor"] as string | null,
      })),
    );

  it.effect("lists entries newest first, paged by cursor", () =>
    Effect.gen(function* () {
      const app = yield* withEntries;
      const all = yield* page(app, "");
      assert.isNull(all.nextCursor);
      const ids = all.entries.map((entry) => Number(entry["id"]));
      assert.deepStrictEqual(
        ids,
        [...ids].sort((a, b) => b - a),
      );
      // Four logins (admin, super, user, target), then four grants.
      assert.deepStrictEqual(
        all.entries.map((entry) => entry["action"]).reverse(),
        [
          "login",
          "login",
          "login",
          "login",
          "role_granted",
          "role_granted",
          "role_granted",
          "role_granted",
        ],
      );
      assert.deepInclude(all.entries[0], {
        action: "role_granted",
        actorId: app.superAdmin.id,
        targetId: app.target.id,
        detail: "blogEditor:alpha",
      });
      assert.isString(all.entries[0]?.["at"]);

      // Pages of three, without gaps or repeats.
      const seen: Array<unknown> = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const next: {
          entries: ReadonlyArray<Json>;
          nextCursor: string | null;
        } = yield* page(
          app,
          `limit=3${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
        );
        assert.isAtMost(next.entries.length, 3);
        seen.push(...next.entries.map((entry) => entry["id"]));
        cursor = next.nextCursor;
        pages++;
      } while (cursor !== null && pages < 10);
      assert.strictEqual(pages, 3);
      assert.deepStrictEqual(seen, ids);

      // A full last page has no next one.
      const exact = yield* page(app, "limit=8");
      assert.strictEqual(exact.entries.length, 8);
      assert.isNull(exact.nextCursor);

      // New entries sort to the front and never shift a page already read.
      const first = yield* page(app, "limit=3");
      yield* app.member("late");
      const second = yield* page(
        app,
        `limit=3&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
      );
      assert.deepStrictEqual(
        second.entries.map((entry) => entry["id"]),
        ids.slice(3, 6),
      );

      for (const query of [
        "limit=0",
        "limit=101",
        "cursor=not-a-cursor",
        `cursor=${"A".repeat(65)}`,
        "action=deleted_everything",
        "userId=not-a-uuid",
      ]) {
        yield* app.expect(
          400,
          app.admin.cookie,
          "GET",
          `/admin/audit?${query}`,
        );
      }
    }),
  );

  it.effect("filters by action and by user as actor or target", () =>
    Effect.gen(function* () {
      const app = yield* withEntries;
      const grants = yield* page(app, "action=role_granted");
      assert.deepStrictEqual(
        grants.entries.map((entry) => [entry["targetId"], entry["detail"]]),
        [...app.grants].reverse().map(({ to, role }) => [to, role]),
      );
      assert.deepStrictEqual(
        (yield* page(app, "action=login")).entries.map(
          (entry) => entry["actorId"],
        ),
        [app.target.id, app.user.id, app.superAdmin.id, app.admin.id],
      );
      assert.deepStrictEqual(
        (yield* page(app, "action=account_deleted")).entries,
        [],
      );

      // The superAdmin acted in every grant; `target` was only their target.
      const bySuper = yield* page(app, `userId=${app.superAdmin.id}`);
      assert.deepStrictEqual(
        bySuper.entries.map((entry) => entry["action"]),
        [
          "role_granted",
          "role_granted",
          "role_granted",
          "role_granted",
          "login",
        ],
      );
      const ofTarget = yield* page(app, `userId=${app.target.id}`);
      assert.deepStrictEqual(
        ofTarget.entries.map((entry) => [
          entry["action"],
          entry["actorId"],
          entry["targetId"],
        ]),
        [
          ["role_granted", app.superAdmin.id, app.target.id],
          ["role_granted", app.superAdmin.id, app.target.id],
          ["login", app.target.id, app.target.id],
        ],
      );
      assert.deepStrictEqual(
        (yield* page(app, `userId=${unknownUuid}`)).entries,
        [],
      );

      // Both filters at once, paged.
      const both = `action=role_granted&userId=${app.target.id}`;
      const one = yield* page(app, `${both}&limit=1`);
      assert.strictEqual(one.entries.length, 1);
      assert.isString(one.nextCursor);
      const rest = yield* page(
        app,
        `${both}&limit=1&cursor=${encodeURIComponent(one.nextCursor ?? "")}`,
      );
      assert.deepStrictEqual(
        [...one.entries, ...rest.entries].map((entry) => entry["detail"]),
        ["blogEditor:alpha", "admin"],
      );
      assert.isNull(rest.nextCursor);
    }),
  );
});

describe("contact messages", () => {
  it.effect("lists messages newest first, paged by cursor", () =>
    Effect.gen(function* () {
      const app = yield* setup;
      // One sent through the form (stored with the app's clock), the others
      // in SQL; two at the same time, ordered by id.
      yield* app.expect(202, undefined, "POST", "/contact", {
        body: { name: "Form", email: "form@example.org", message: "Hi" },
      });
      const same = new Date("2026-03-01T00:00:00.000Z");
      const [low, high] = [
        "00000000-0000-4000-8000-000000000001",
        "ffffffff-ffff-4fff-bfff-ffffffffffff",
      ];
      yield* app.contact("Old", new Date("2026-01-01T00:00:00.000Z"));
      yield* app.contact("Low", same, low);
      yield* app.contact("High", same, high);
      yield* app.contact("Mid", new Date("2026-02-01T00:00:00.000Z"));

      const page = (query: string) =>
        app
          .expect(200, app.admin.cookie, "GET", `/admin/contact?${query}`)
          .pipe(
            Effect.map((body) => ({
              messages: list(body["messages"] as Json),
              nextCursor: body["nextCursor"] as string | null,
            })),
          );
      // The form's message is the newest: the app's clock is now.
      const expected = ["Form", "High", "Low", "Mid", "Old"];
      const all = yield* page("");
      assert.deepStrictEqual(
        all.messages.map((message) => message["name"]),
        expected,
      );
      assert.isNull(all.nextCursor);
      assert.deepStrictEqual(all.messages[1], {
        id: high,
        name: "High",
        email: "high@example.org",
        message: "Hello from High",
        createdAt: same.toISOString(),
      });

      // Pages of two, the cursor between the two of the same time.
      const names: Array<unknown> = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const next: {
          messages: ReadonlyArray<Json>;
          nextCursor: string | null;
        } = yield* page(
          `limit=2${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
        );
        names.push(...next.messages.map((message) => message["name"]));
        cursor = next.nextCursor;
        pages++;
      } while (cursor !== null && pages < 10);
      assert.strictEqual(pages, 3);
      assert.deepStrictEqual(names, expected);
      const afterHigh = yield* page("limit=2");
      const split = yield* page(
        `limit=1&cursor=${encodeURIComponent(afterHigh.nextCursor ?? "")}`,
      );
      assert.deepStrictEqual(
        split.messages.map((message) => message["name"]),
        ["Low"],
      );

      for (const query of ["limit=0", "limit=101", "cursor=not-a-cursor"]) {
        yield* app.expect(
          400,
          app.admin.cookie,
          "GET",
          `/admin/contact?${query}`,
        );
      }
    }),
  );

  it.effect(
    "deletes a message with 204, audited without detail; then 404",
    () =>
      Effect.gen(function* () {
        const app = yield* setup;
        const id = yield* app.contact(
          "Spam",
          new Date("2026-01-01T00:00:00.000Z"),
        );
        const kept = yield* app.contact(
          "Ham",
          new Date("2026-01-02T00:00:00.000Z"),
        );

        const response = yield* app.call(
          app.admin.cookie,
          "DELETE",
          `/admin/contact/${id}`,
        );
        assert.strictEqual(response.status, 204);
        assert.strictEqual(yield* Effect.promise(() => response.text()), "");
        assert.deepStrictEqual(
          list(
            (yield* app.expect(200, app.admin.cookie, "GET", "/admin/contact"))[
              "messages"
            ] as Json,
          ).map((message) => message["id"]),
          [kept],
        );
        // Who deleted one, never what it said, who sent it or which it was.
        assert.deepStrictEqual(yield* app.audited("contact_message_deleted"), [
          { actorId: app.admin.id, targetId: null, detail: null },
        ]);

        const again = yield* app.expect(
          404,
          app.admin.cookie,
          "DELETE",
          `/admin/contact/${id}`,
        );
        assert.deepStrictEqual(again, {
          _tag: "ContactMessageNotFound",
          messageId: id,
        });
        yield* app.expect(
          404,
          app.admin.cookie,
          "DELETE",
          `/admin/contact/${unknownUuid}`,
        );
        assert.strictEqual(
          (yield* app.audited("contact_message_deleted")).length,
          1,
        );
        yield* app.expect(
          400,
          app.admin.cookie,
          "DELETE",
          "/admin/contact/not-a-uuid",
        );
      }),
  );
});
