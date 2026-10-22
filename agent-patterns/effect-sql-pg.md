# Effect pattern: SQL with Postgres (effect/sql, @effect/sql-pg)

> Derived from repos/effect at effect@4.0.5 (subtree 7c94a19, upstream bc07bd4e8), 2026-10-21.
> Re-generate with `/effect-patterns sql-pg` after `/effect-update`.

All of `effect/sql` and `@effect/sql-pg` is `@stability unstable`. Schema changes go through the
`db-migration` agent; committed migrations are immutable.

## Imports

```ts
import {
  Schema,
  Effect,
  Layer,
  Context,
  DateTime,
  Option,
  Cause,
} from "effect";
import { Model } from "effect/schema"; // was @effect/sql/Model
import {
  SqlClient,
  SqlError,
  SqlModel,
  SqlSchema,
  type Statement,
} from "effect/sql";
import { PgClient, PgMigrator } from "@effect/sql-pg"; // production
import { PgliteClient, PgliteMigrator } from "@effect/sql-pglite"; // tests
```

Repositories depend only on `SqlClient.SqlClient`, never on `PgClient`.

## Core constructors and combinators

- `` sql`...` `` tagged template: values are bound parameters; `sql("table")` is an identifier;
  ` sql` `` is the empty fragment for conditional parts.
- `sql.insert(row)`, `sql.update(row, omitKeys)`, `sql.in("col", values)`, `sql.and([...])`, `sql.csv(...)`.
- `SqlSchema.findAll | findOne | findOneOption | void({ Request, Result?, execute })`: encode the request,
  run `execute`, decode rows. `findOne` fails with `Cause.NoSuchElementError` on no row.
- `Model.Class<Self>("Name")({...})` gives variants `Name` (select), `.insert`, `.update`, `.json`, `.jsonCreate`,
  `.jsonUpdate`. Fields: `Model.Field({ select, insert, update, json })`, `Model.FieldExcept([...variants])`,
  `Model.FieldOnly`, `Model.GeneratedByDb(s)`, `Model.UuidV4Insert`, `Model.DateTimeInsert/Update`.
- `SqlModel.makeRepository(Model, { tableName, spanPrefix, idColumn })` gives
  `insert | insertVoid | update | updateVoid | findById | delete`.
- `sql.withTransaction(effect)`; nested calls become savepoints. Inside use `sql.transactionService` for depth.
- `PgMigrator.fromRecord({ "0001_name": effect })`, `PgMigrator.layer({ loader })`.

## Common patterns

Client options: snake_case columns, camelCase TypeScript, jsonb keys untouched.
Source: services/backend/src/infrastructure/Database.ts (adapted from repos/effect/packages/sql/pg/src/PgClient.ts)

```ts
export const clientOptions = {
  transformQueryNames: Str.camelToSnake,
  transformResultNames: Str.snakeToCamel,
  transformJson: false,
} as const;
const PgLive = PgClient.layerConfig(
  DatabaseConfig.pipe(Config.map((c) => ({ ...c, ...clientOptions }))),
);
```

Database layer: migrations run at layer construction, so everything built on it sees a migrated schema.
Source: services/backend/src/infrastructure/Database.ts, services/backend/src/testing/Database.ts

```ts
const MigrationsLive = PgMigrator.layer({
  loader: PgMigrator.fromRecord(migrations),
}).pipe(Layer.provide(MigratorServices)); // spawner + FileSystem + Path, for the optional pg_dump
export const DatabaseLive = MigrationsLive.pipe(Layer.provideMerge(PgLive)); // exposes SqlClient
// tests, in-memory:
export const DatabaseTest = PgliteMigrator.layer({
  loader: migrationLoader,
}).pipe(Layer.provideMerge(PgliteClient.layer(clientOptions)));
```

Migrations are imported statically (the service is bundled), keyed `<id>_<name>`; a test checks the
record matches the folder.

Migration: an `Effect` that uses `SqlClient`, default export, one statement per `sql` call.
Source: services/backend/src/migrations/0005_create_outbox.ts

```ts
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE outbox (id bigint GENERATED ALWAYS AS IDENTITY, topic text NOT NULL,
    payload jsonb NOT NULL, created_at timestamptz NOT NULL, CONSTRAINT outbox_id_pkey PRIMARY KEY (id))`;
  yield* sql`CREATE INDEX outbox_topic_idx ON outbox (topic, id) WHERE dead_at IS NULL`;
});
```

Name constraints explicitly (`<table>_<col>_pkey|fkey|check`): code matches on them (`isUniqueViolation`).

Model with per-variant fields (nullable column as Option, jsonb as JSON text, DB-generated column).
Source: services/backend/src/auth/Sessions.ts, domains/users/User.ts

```ts
export class Session extends Model.Class<Session>("Session")({
  idHash: Schema.Uint8Array,
  providerSessionId: Schema.OptionFromNullOr(Schema.String),
  claims: Model.Field({ select: SessionClaims, insert: Schema.fromJsonString(SessionClaims), json: SessionClaims }),
  createdAt: Model.GeneratedByDb(Schema.DateTimeUtcFromDate),
  expiresAt: Schema.DateTimeUtcFromDate,
}) {}
subject: Subject.pipe(Model.FieldExcept(["update", "jsonUpdate"])), // immutable after insert
```

Repository service: queries built once in `make`, exposed through a `Context.Service` plus `static layer`.
Source: services/backend/src/auth/Sessions.ts, domains/users/UserRepository.ts

```ts
const find = SqlSchema.findOneOption({
  Request: Schema.Struct({
    idHash: Schema.Uint8Array,
    now: Schema.DateTimeUtcFromDate,
  }),
  Result: Session,
  execute: ({ idHash, now }) =>
    sql`SELECT * FROM auth_sessions WHERE id_hash = ${idHash} AND expires_at > ${now}`,
});
const repository =
  yield *
  SqlModel.makeRepository(User, {
    tableName: "users",
    spanPrefix: "UserRepository",
    idColumn: "id",
  });
repository.findById(id).pipe(
  Effect.asSome,
  Effect.catchIf(Cause.isNoSuchElementError, () => Effect.succeedNone),
);
repository.updateVoid(User.update.make(user));
export class Sessions extends Context.Service<
  Sessions,
  {
    readonly find: (
      h: Uint8Array,
    ) => Effect.Effect<Option.Option<Session>, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/Sessions") {
  static readonly layer = Layer.effect(Sessions, make);
}
```

Method signatures keep `SqlError.SqlError` and drop `SchemaError`: `dieOnSchemaError` (`Effect.catchTag("SchemaError", Effect.die)`,
infrastructure/Sql.ts) turns it into a defect, because rows are written by us. Name spans: `Effect.fn("Sessions.find")`.

SQL snippets: conditional fragments, `IN`, locking, upsert, `RETURNING`, counting deletes.
Source: domains/users/UserRepository.ts, cqrs/Outbox.ts, infrastructure/Sql.ts

```ts
sql`SELECT * FROM users WHERE ${sql.in("id", ids)} ORDER BY id FOR NO KEY UPDATE`;
sql`SELECT * FROM users ${after === null ? sql`` : sql`WHERE (created_at, id) > (${t}, ${id}::uuid)`}`;
sql`INSERT INTO users ${sql.insert(row)} ON CONFLICT (subject) DO NOTHING RETURNING id`;
sql`... WHERE id IN (SELECT id FROM outbox WHERE ... ORDER BY id LIMIT ${n} FOR UPDATE SKIP LOCKED)`;
sql`WITH deleted AS (${deleteStatement} RETURNING 1) SELECT count(*)::int AS count FROM deleted`;
```

Cast when the column type isn't text (`${id}::uuid`, `RETURNING id::text`). Pass times as `DateTime.Utc` (via
`Schema.DateTimeUtcFromDate`), taken from the Effect clock (`DateTime.now`) so `TestClock` works.

Transactions in the kernel: `Transaction.run` wraps `sql.withTransaction`, queues domain events and publishes them
after the outermost commit; a nested run is a savepoint. Commands use `Command.boundary(transaction)`, queries `Query.boundary`.
Source: services/backend/src/cqrs/Transaction.ts, domains/users/UserCommands.ts, UserQueries.ts

```ts
deleteAccount: Effect.fn("UserCommands.deleteAccount")(function* (subject) {
  const found = yield* users.findBySubjectForUpdate(subject);   // lock the row, then decide
  yield* users.update(User.anonymise(user, now));
  yield* outbox.enqueue(DeleteKeycloakUser, { subject });       // same transaction as the state change
  yield* DomainEvent.record(new User.AccountDeleted({ userId: user.id }));
}, Command.boundary(transaction)),
```

Never call `sql.withTransaction` directly in domain code (`Transaction.run` dies if it finds one it didn't open).

## Error handling

- `SqlError.SqlError` carries `reason` (tagged: `UniqueViolation` with `constraint`, `DeadlockError`, `ConnectionError`, ...).
  Test with `SqlError.isSqlError(e) && e.reason._tag === "UniqueViolation"`.
- A failed statement aborts the Postgres transaction. Catch a unique violation only around a savepoint (`transaction.run(save)`),
  then map it to a domain error (`Effect.catchIf(isUniqueViolation(postSlugConstraint), () => Effect.fail(new PostSlugTaken(...)))`).
  Source: services/backend/src/infrastructure/Columns.ts, domains/blogs/BlogCommands.ts
- `Query.boundary`/`Command.boundary` turn `SqlError` and `SchemaError` into scrubbed defects (no SQL in responses).

## Testing

Fresh in-memory Postgres per layer build; share with `layer(...)` and keep tests independent of each other's rows.
Source: services/backend/src/auth/Sessions.test.ts, testing/Database.ts

```ts
const TestLayer = Sessions.layer.pipe(Layer.provideMerge(DatabaseTest));
describe("Sessions", () => {
  layer(TestLayer, { timeout: "30 seconds" })((it) => {
    it.effect("finds a session", () =>
      Effect.gen(function* () {
        /* yield* Sessions ... */
      }),
    );
  });
});
```

Use `TestClock` from `effect/testing` for expiry. Test code may import `#testing/*`; production code must not (PGlite).

## v3 → v4 differences (old spelling → new spelling)

Source: repos/effect/migration/v3-to-v4.md, sections `@effect/sql/*`, `@effect/sql-pg/PgClient`

- `@effect/sql`, `@effect/sql/Model` → `effect/sql`, `effect/schema` (`Model`); only drivers keep `@effect/sql-*`.
- `Model.Generated` → `Model.GeneratedByDb` (read-only: select/json only); `Model.DateTimeFromDate` → `Schema.DateTimeUtcFromDate`.
- `Model.makeRepository` → `SqlModel.makeRepository`; `Model.makeDataLoaders` → `SqlModel.makeResolvers`.
- `SqlSchema.single` → `SqlSchema.findOne`; empty result is `Cause.NoSuchElementError`, decode failures `Schema.SchemaError`.
- `SqlResolver.*` return plain `RequestResolver`s: run with `SqlResolver.request`.
- `PgClient.fromPool`/`layerFromPool` removed; use `PgClient.layer` / `layerConfig` (pool options in `PgPoolConfig`).
- `SqlError` has typed `reason`s and `SqlError.isSqlError`; no `SqlErrorTypeId`.
- `SqlClient.TransactionConnection` tag → `sql.transactionService`; `Context.Tag` → `Context.Service`.

## Avoid

- `SELECT *` into a model whose columns differ from the table, or string-concatenated SQL (use `sql` fragments).
- Editing a committed migration, or relying on migrations being read from disk at runtime.
- Opening transactions with `sql.withTransaction` in domains, or publishing events before the commit.
- Importing `@effect/sql-pg` outside `infrastructure/Database.ts`; `@effect/sql` (v3) packages.
- Putting snake_case in TypeScript: the client converts names, but jsonb contents (`transformJson: false`) keep theirs.
