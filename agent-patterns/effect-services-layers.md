# Effect pattern: Services and Layers

> Derived from repos/effect at effect@4.0.5 (subtree 7c94a19, upstream bc07bd4e8), 2026-10-21.
> Re-generate with `/effect-patterns services-layers` after `/effect-update`.

## Imports

```ts
import { Context, Duration, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
```

All APIs below are `@stability stable` (including `Layer.mock`).

## Core constructors and combinators

- `Context.Service<Self, Shape>()("id")` — class-based service. Id convention in
  this repo: `"@unhalteproblem.de/backend/<path>"`. `Self.of(impl)` types an impl.
- `Context.Service<Shape>("id")` — non-class key; `Context.Reference<T>("id", { defaultValue })`
  — a service with a default, needs no layer.
- `Layer.succeed(Svc, impl)` (or curried `Layer.succeed(Svc)(impl)`) — constant impl.
- `Layer.effect(Svc, effect)` — build from an Effect. Scoped resources are allowed
  (`Effect.acquireRelease` is closed with the layer; v3 `Layer.scoped` is gone).
- `Layer.effectDiscard(effect)` — background job layer, provides nothing.
- `Layer.unwrap(effect)` — pick/build a layer from an Effect or Config.
- `Layer.mergeAll(a, b)` / `Layer.merge` — union of outputs.
- `Layer.provide(dep)` — feed `dep` into the layer, hide `dep`'s outputs.
- `Layer.provideMerge(dep)` — same, but keep `dep`'s outputs visible (tests).
- `Layer.orDie`, `Layer.fresh`, `Layer.build` (needs a `Scope`), `Layer.launch`
  (run as the process entry point), `Layer.mock(Svc, partialImpl)` (omitted
  members throw if called).

## Common patterns

### Service class with a `layer` static (one file per service)

```ts
export class Readiness extends Context.Service<
  Readiness,
  { readonly check: Effect.Effect<void, NotReady> }
>()("@unhalteproblem.de/backend/Readiness") {
  static readonly layerWith = (timeout: Duration.Input) =>
    Layer.effect(
      Readiness,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return Readiness.of({
          check: sql`SELECT 1`.pipe(
            Effect.timeout(timeout),
            Effect.asVoid /* … */,
          ),
        });
      }),
    );
  static readonly layer = Readiness.layerWith(Duration.seconds(2));
}
```

Source: services/backend/src/infrastructure/Readiness.ts (this repo). Methods are
`Effect.fn("Svc.method")(function* (…) {…})` so they get a span; dependencies
are yielded once in the `make` effect and closed over, so methods have
`R = never`. Document needed layers on `layer` ("Needs `Outbox` and …").

### `make` effect plus `layer`

```ts
const make = Effect.gen(function* () {
  const users = yield* UserRepository;
  const transaction = yield* Transaction;
  return UserCommands.of({
    syncFromLogin: Effect.fn("UserCommands.syncFromLogin")(function* (login) {
      /* … */
    }, Command.boundary(transaction)),
  });
});
// in the class body:
static readonly layer = Layer.effect(UserCommands, make);
```

Source: services/backend/src/domains/users/UserCommands.ts. v4's
`Context.Service<Self>()(id, { make })` also exists but does not generate a
layer (migration/services.md); this repo keeps `make` separate.

### `layerWith(options)` for tests; dependencies provided inside the layer

`layer` reads config; `layerWith({ limit: 2, globalLimit: 100, window: "1 hour" })`
takes explicit values, so tests build exact limits.

```ts
static readonly layer = Layer.effect(ContactRateLimit, make /* … */).pipe(
  Layer.provide(RateLimiterMemory),
);
```

Source: services/backend/src/domains/contact/ContactRateLimit.ts. Variant layers use
suffixes (`layerSmtp`, `layerDisabled`, `layerWith`); the primary one is `layer`.

### Compose: `provide` hides, `provideMerge` exposes

```ts
const layerNoDeps: Layer.Layer<UserRepository, never, SqlClient.SqlClient> = /* … */;
const layer = layerNoDeps.pipe(Layer.provide(SqlClientLayer)); // only UserRepository
const withSql = layerNoDeps.pipe(Layer.provideMerge(SqlClientLayer)); // both
```

Source: repos/effect/ai-docs/src/01_effect/03_services/20_layer-composition.ts.
Several layers at once: `Layer.provide([A.layer, B.layer])`. In this repo
(services/backend/src/testing/Users.ts) a stack is
`Layer.mergeAll(A, B).pipe(Layer.provideMerge(repos), Layer.provideMerge(KernelTest))`,
so every layer below stays accessible to the test.

### Resource with release

```ts
const transport =
  yield *
  Effect.acquireRelease(
    Effect.sync(() => createTransport({/* … */})),
    (transport) => Effect.sync(() => transport.close()),
  );
```

Source: services/backend/src/infrastructure/Mailer.ts (`layerSmtp`), inside `Layer.effect`.

### Config-driven layer choice: `Layer.unwrap`

```ts
const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const { port, host } = yield* ServerConfig;
    return NodeHttpServer.layer(createServer, { port, host });
  }),
);
```

Source: services/backend/src/Server.ts.

### Background job: `Layer.effectDiscard` + `forkScoped`

```ts
export const ContactCleanup = Layer.effectDiscard(
  Effect.gen(function* () {
    const commands = yield* ContactCommands;
    yield* commands.purgeOlderThan(retention).pipe(
      Effect.catchCause((cause) => Effect.logWarning("Cleanup failed", cause)),
      Effect.repeat(Schedule.spaced("1 hour")),
      Effect.interruptible,
      Effect.forkScoped,
    );
  }),
);
```

Source: services/backend/src/domains/contact/ContactCleanup.ts. The fiber
ends when the layer's scope closes. Entry point: `Layer.launch(Server).pipe(NodeRuntime.runMain)`
(services/backend/src/main.ts).

### Wrap a service (decorator layer)

```ts
Layer.effect(UserRepository, Effect.gen(function* () {
  const repository = yield* UserRepository;
  return UserRepository.of({ ...repository, findBySubjectForUpdate: /* override */ });
})).pipe(Layer.provide(UserRepository.layer))
```

Source: services/backend/src/domains/users/UserCommands.test.ts.

## Error handling

- Layer construction errors are typed in `Layer<A, E, R>`. Use `Layer.orDie`
  where startup failure should be a defect (`Layer.orDie(DatabaseTest)`),
  `Layer.catch` / `Layer.catchCause` to recover (v3: `catchAll`, `catchAllCause`).
- Service methods fail with domain errors only; infrastructure errors become
  defects at the boundary (`Command.boundary`, `Query.boundary`).

## Testing

Swap implementations with `Layer.succeed(Svc, Svc.of({…}))`, or
`Layer.mock(Svc, { someMethod })` for partial stubs. A recording fake
returns `{ sent, layer }`: see services/backend/src/testing/Mailer.ts. See
effect-testing.md for `layer(...)` sharing.

## v3 → v4 differences (old spelling → new spelling)

- `Context.Tag("id")<Self, Shape>()`, `Effect.Tag`, `Effect.Service` → `Context.Service<Self, Shape>()("id")`
  (type params first, id second). No `Default`/`dependencies`/accessors: use
  `yield* Svc` (or `Svc.use(s => …)`), and `Layer.provide` for dependencies.
- `Layer.scoped` / `scopedDiscard` / `unwrapScoped` / `unwrapEffect` → `Layer.effect` / `effectDiscard` / `unwrap`.
- `Layer.Layer.Context<T>` → `Layer.Services<T>`; `Layer.toRuntime` → `Layer.build` + `ManagedRuntime`.
- `Layer.setClock/setConfigProvider/setTracer…` → `Layer.succeed(Clock.Clock, …)`, `ConfigProvider.layer(…)`.
- Memoization is shared across `Effect.provide` calls now; opt out with `Layer.fresh`
  or `Effect.provide(layer, { local: true })`. Still compose first, provide once.
- Layers named `layer` (not `Default`/`Live`; this repo also has `…Live` for composed app layers).

Source: repos/effect/migration/services.md, layer-memoization.md.

## Avoid

- Building the same layer by hand per test when `layer(...)` can share it.
- `Effect.provide` many times in a row; compose layers first.
- Service methods that still require other services (`R != never`): yield deps in `make`.
- Importing `#testing/*` from production code (PGlite would end up in the bundle).
