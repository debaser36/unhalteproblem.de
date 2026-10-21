# Effect pattern: Testing

> Derived from repos/effect at effect@4.0.5 (subtree 7c94a19, upstream bc07bd4e8), 2026-10-21.
> Re-generate with `/effect-patterns testing` after `/effect-update`.

## Imports

```ts
import { assert, describe, it, layer } from "@effect/vitest"; // @stability unstable
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option } from "effect";
import { TestClock } from "effect/testing"; // stable
import { HttpServer } from "effect/http";
import { HttpApiTest } from "effect/http-api"; // @stability unstable
```

`@effect/vitest`'s `it.effect`, `it.live` and `layer` are `@stability unstable`,
as is `HttpApiTest`; `TestClock` is stable. Run: `pnpm --filter <pkg> test`
(`--reporter=dot`). The backend sets `testTimeout`/`hookTimeout` to 30 s in
services/backend/vitest.config.ts (PGlite + migrations are slow).

## Core constructors and combinators

- `it.effect(name, () => Effect)` — test clock (`TestClock`) and test console
  are provided, plus a `Scope`. Time only moves when you `TestClock.adjust`.
- `it.live` — real clock/runtime services (real sleeps, real timers).
- `it.effect.each([...])("name %s", (x) => Effect)` — parameterized.
- `it.effect.prop("name", [Schema.String], ([s]) => Effect)` — property test.
- `layer(L, { timeout })((it) => { it.effect(...) })` — build `L` once for the
  block, share it across its tests, tear it down after. `it.layer(L2)("nested", …)` adds more.
- `assert.*` (chai-like): `strictEqual`, `deepStrictEqual`, `isTrue`, `isFalse`,
  `instanceOf`, `include`, `match`.
- `Effect.exit` (inspect the `Exit`), `Effect.flip` (swap error to success),
  `Effect.forkChild` + `Fiber.join`, `Deferred`, `TestClock.adjust` / `setTime`.

## Common patterns

### Plain test, error via `Effect.flip`

```ts
it.effect("answers MediaNotFound for an unknown id", () =>
  Effect.gen(function* () {
    const queries = yield* MediaQueries;
    const failure = yield* queries.get(MediaId.make("0000…")).pipe(Effect.flip);
    assert.instanceOf(failure, MediaNotFound);
  }),
);
```

Source: services/backend/src/domains/media/Media.test.ts (the layer is
provided by an enclosing `layer(...)`).

### Provide a layer to one test

```ts
it.effect("gives every client its own quota", () =>
  Effect.gen(function* () {
    assert.isTrue(Exit.isSuccess(yield* consumeExit("a")));
  }).pipe(
    Effect.provide(
      ContactRateLimit.layerWith({
        limit: 2,
        globalLimit: 100,
        window: "1 hour",
      }),
    ),
  ),
);
```

Source: services/backend/src/services/ContactRateLimit.test.ts. Here the
layer is built per test, so tests don't share state.

### Share one expensive layer (database) across a `describe`

```ts
describe("Outbox", () => {
  layer(TestLayer, { timeout: "30 seconds" })((it) => {
    it.effect("hands a committed message to the handler and deletes it", () =>
      Effect.gen(function* () {
        /* … */
      }),
    );
  });
});
```

Source: services/backend/src/cqrs/Outbox.test.ts. `TestLayer` is built with
`Layer.provideMerge(DatabaseTest)` so tests can `yield* SqlClient.SqlClient`.
Tests then share rows: use unique keys per test (`crypto.randomUUID()`,
`freshTopic()`), never assume an empty table.

### In-memory Postgres per test

`DatabaseTest` (services/backend/src/testing/Database.ts) is
`PgliteMigrator.layer({ loader }).pipe(Layer.provideMerge(PgliteClient.layer(options)))`:
every build is a fresh migrated database. Compose domain test stacks with
`Layer.provideMerge` (services/backend/src/testing/Users.ts: `KernelTest`, `UsersTest`).
Test-support code lives in `src/testing/` (`#testing/*`) only.

### Control time with `TestClock`

```ts
const first = yield * commands.syncFromLogin(login(subject));
yield * TestClock.adjust("1 hour");
const second = yield * commands.syncFromLogin(login(subject));
// DateTime.now inside the command reads the test clock
```

Source: services/backend/src/domains/users/UserCommands.test.ts. For code that
sleeps: fork it, adjust, then join (repos/effect/ai-docs/src/09_testing/10_effect-tests.ts):

```ts
const fiber =
  yield * Effect.forkChild(Effect.sleep(60_000).pipe(Effect.as("done")));
yield * TestClock.adjust(60_000);
assert.strictEqual(yield * Fiber.join(fiber), "done");
```

If the forked effect also does real I/O (database) between sleeps, adjust in a
loop until a flag flips (services/backend/src/cqrs/Outbox.test.ts).

### Background fibers: `it.live` + `Layer.build` + `Deferred`

```ts
it.live("handles messages in the background until its scope ends", () =>
  Effect.gen(function* () {
    const handled = yield* Deferred.make<Payload>();
    yield* Layer.build(
      Outbox.consumer(topic, (p) => Deferred.succeed(handled, p), {
        pollInterval: "10 millis",
      }),
    );
    yield* send(topic, { n: 7, to: "a" });
    assert.deepStrictEqual(yield* Deferred.await(handled), { n: 7, to: "a" });
  }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);
```

Source: services/backend/src/cqrs/Outbox.test.ts. Wait on a `Deferred`, never
`sleep` and hope; with `it.live`, bound any polling loop.

### Config tests with a fake provider

```ts
const load = <A, E>(config: Effect.Effect<A, E>, env: Record<string, string>) =>
  config.pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    Effect.exit,
  );
```

Source: services/backend/src/Config.test.ts (also uses `it.effect.each`).

### HTTP handlers: `HttpApiTest.groups` (unstable)

```ts
const makeClient = HttpApiTest.groups(Api, ["contact"]);
// layer = ContactHandlers.pipe(Layer.provide([fakeCommands, rateLimit]),
//   Layer.merge(HttpServer.layerServices), Layer.merge(MiddlewaresRejectAll))
const client = yield * makeClient;
const response =
  yield * client.contact.submit({ payload, responseMode: "response-only" });
assert.strictEqual(response.status, 202);
```

Source: services/backend/src/http/Contact.test.ts (the system group test,
http/System.test.ts, uses `client.ready().pipe(Effect.flip)`). No server is
started; encoding and middleware run as in production. Full-app tests use
`makeApp` from `#testing/App`.

### Fakes that record

`const { sent, layer } = makeRecordingMailer()` returns the array and a
`Layer.succeed(Mailer, Mailer.of({...}))`; assert on `sent` afterwards.
Source: services/backend/src/testing/Mailer.ts. Use `Effect.die("not used")`
for methods the test must not call.

## Error handling

- Typed failure: `Effect.flip` (then `assert.instanceOf`) or `Effect.exit`
  with `Exit.isFailure` / `Exit.findErrorOption`.
- Defects: `Exit.isFailure(exit) && Cause.hasDies(exit.cause)`
  (services/backend/src/cqrs/Outbox.test.ts).
- Interruption inside a handler: `Effect.interrupt`; assert the effect on state.

## v3 → v4 differences (old spelling → new spelling)

- `it.scoped` → `it.effect` (scope is always provided); `it.live` stays.
- `TestContext.TestContext` → provided by `it.effect`; `TestClock.defaultTestClock`
  → `TestClock.layer()`; `TestClock.adjustWith` removed (fork + adjust).
- `TestClock.sleeps` / `save` removed; test via forked fibers.
- `Effect.fork` → `Effect.forkChild`; `forkDaemon` → `forkDetach`.
- `TestConfig` removed; `Effect.catchAll` → `Effect.catch`.
- `layer(...)` options: `timeout`, `concurrent`, `memoMap`, `excludeTestServices`.

Source: repos/effect/migration/v3-to-v4.md (`effect/TestClock`, `effect/TestContext`),
migration/forking.md.

## Avoid

- `Effect.runPromise` inside tests; return the Effect from `it.effect`.
- Real `sleep` in `it.effect` (hangs: the test clock never advances by itself).
- Asserting on an empty shared database; scope data by a unique key.
- Mocking with `vi.fn`; write a small fake service layer instead.
