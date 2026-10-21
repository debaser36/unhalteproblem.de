# Effect pattern: v3 -> v4 renames

> Derived from repos/effect at effect@4.0.5 (subtree 7c94a19, upstream bc07bd4e8), 2026-10-21.
> Re-generate with `/effect-patterns v3-to-v4` after `/effect-update`.

Lookup table for code written from v3 habits. Every v4 name was checked against
`repos/effect/packages/effect/src`. `src` is the line in
`repos/effect/migration/v3-to-v4.md` with the full per-API note; the sibling
files `services.md`, `error-handling.md`, `forking.md`, `yieldable.md`, `cause.md`,
`runtime.md` and `schema.md` have longer prose. A row with `a / b` covers siblings
renamed the same way.

Rules of thumb: `catchAll*` -> `catch*`; `*Either` -> `*Result`; `unsafeX` -> `xUnsafe`;
`*Nullable` -> `*NullishOr`; `getEquivalence/getOrder` -> `makeEquivalence/makeOrder`;
`greaterThan` etc. -> `isGreaterThan`; `*FromSelf` -> no suffix; `Tag`/`Service` -> `Context.Service`;
`@effect/platform|sql|rpc|cli|cluster|ai` -> `effect/<module>`. No import path contains `unstable`.

## Imports and packages

| v3                                                                                   | v4                                                                          | note                                                                              | src  |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---- |
| `@effect/platform Http* (Client, Server, Router, Body, Cookies, Headers, UrlParams)` | `effect/http`                                                               | one barrel; drop any `unstable` segment                                           | 533  |
| `@effect/platform HttpApi*, OpenApi`                                                 | `effect/http-api`                                                           | HttpApi, Builder, Client, Endpoint, Group, Middleware, Scalar, Schema, Security   | 521  |
| `HttpApp`                                                                            | `effect/http HttpEffect`                                                    | module renamed                                                                    | 531  |
| `HttpLayerRouter, HttpRouter`                                                        | `HttpRouter (effect/http)`                                                  | one router; HttpLayerRouter.addHttpApi -> HttpApiBuilder.layer                    | 7177 |
| `@effect/sql (SqlClient, SqlSchema, Migrator, Statement, SqlError, SqlResolver)`     | `effect/sql`                                                                | drivers (@effect/sql-pg, sql-pglite) stay separate packages                       | 622  |
| `@effect/sql Model`                                                                  | `effect/schema Model (Class, Field, GeneratedByDb) and effect/sql SqlModel` | repositories: SqlModel.makeRepository                                             | 621  |
| `@effect/platform FileSystem, Path, Terminal, Error`                                 | `effect/FileSystem, effect/Path, effect/Terminal, effect/PlatformError`     | top-level modules in effect                                                       | 518  |
| `@effect/cli, @effect/rpc, @effect/cluster, @effect/workflow, @effect/ai`            | `effect/cli, effect/rpc, effect/cluster, effect/workflow, effect/ai`        | same module names; cli: Options.text -> Flag.String, Args.text -> Argument.String | 402  |
| `effect/Either`                                                                      | `effect/Result`                                                             | Left/Right -> Failure/Success                                                     | 689  |
| `effect/JSONSchema`                                                                  | `effect/JsonSchema`                                                         | -                                                                                 | 700  |
| `effect/ParseResult`                                                                 | `effect/SchemaIssue, effect/SchemaParser`                                   | -                                                                                 | 720  |
| `effect/TRef, TQueue, TMap, TSet, ...`                                               | `effect/TxRef, TxQueue, TxHashMap, TxHashSet, ...`                          | STM module itself stays                                                           | 747  |
| `effect/TestClock`                                                                   | `effect/testing TestClock`                                                  | @effect/vitest stays a separate package                                           | 757  |

## Services and Layers

| v3                                                                    | v4                                                          | note                                                                                                            | src   |
| --------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----- |
| `Context.Tag("X")<Self, Shape>()`                                     | `Context.Service<Self, Shape>()("X")`                       | type params first, id second; same for Effect.Tag                                                               | 9547  |
| `Context.GenericTag<T>("X")`                                          | `Context.Service<T>("X")`                                   | -                                                                                                               | 9537  |
| `Effect.Service<Self>()("X", { effect, dependencies })`               | `Context.Service<Self>()("X", { make })`                    | no auto `.Default`/`dependencies`; build `static layer = Layer.effect(this, this.make).pipe(Layer.provide(..))` | 9845  |
| static accessors `Svc.method(..)`                                     | `yield* Svc` then call, or `Svc.use(s => ..)`               | accessors removed (generics were erased)                                                                        | 9879  |
| `class Foo extends Context.Reference<Foo>()("Foo", { defaultValue })` | `const Foo = Context.Reference<T>("Foo", { defaultValue })` | -                                                                                                               | 9541  |
| `Context.isTag / unsafeGet / unsafeMake`                              | `Context.isKey / getUnsafe / makeUnsafe`                    | -                                                                                                               | 9565  |
| `Effect.Effect.Context<T>`                                            | `Effect.Services<T>`                                        | type extractor; also Layer.Layer.Context -> Layer.Services                                                      | 9817  |
| `Layer.scoped / scopedDiscard / scopedContext`                        | `Layer.effect / effectDiscard / effectContext`              | Scope is handled by Layer.effect                                                                                | 11696 |
| `Layer.unwrapEffect / unwrapScoped`                                   | `Layer.unwrap`                                              | -                                                                                                               | 11734 |
| `Layer.catchAll / catchAllCause / tapErrorCause`                      | `Layer.catch / catchCause / tapCause`                       | -                                                                                                               | 11632 |
| `Layer.fail / die / failCause`                                        | `Layer.unwrap(Effect.fail(e))`                              | constructors removed                                                                                            | 11652 |
| `Layer.setConfigProvider`                                             | `ConfigProvider.layer(provider)`                            | setClock/setRandom/setTracer -> Layer.succeed(Clock.Clock, ..)                                                  | 11706 |
| `Layer.toRuntime`                                                     | `Layer.build(layer) then Effect.runForkWith(ctx)`           | or ManagedRuntime.make for a reusable runtime                                                                   | 11730 |
| per-`Effect.provide` memoization                                      | `layers shared across Effect.provide calls`                 | opt out: `Layer.fresh` or `Effect.provide(l, { local: true })`                                                  | 11684 |

## Effect

| v3                                                                 | v4                                               | note                                                                          | src   |
| ------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------- | ----- |
| `Effect.catchAll`                                                  | `Effect.catch`                                   | -                                                                             | 9909  |
| `Effect.catchAllCause / catchAllDefect`                            | `Effect.catchCause / catchDefect`                | -                                                                             | 9911  |
| `Effect.catchSome / catchSomeCause`                                | `Effect.catchFilter / catchCauseFilter`          | takes a `Filter` (Filter.fromPredicate), not Option                           | 9915  |
| `Effect.tapErrorCause`                                             | `Effect.tapCause`                                | Effect.tapError / tapErrorTag unchanged                                       | 10143 |
| `Effect.either`                                                    | `Effect.result`                                  | returns Result (Success/Failure); Effect.exit unchanged                       | 9957  |
| `Effect.async / asyncEffect`                                       | `Effect.callback`                                | register may return a cleanup Effect                                          | 9895  |
| `Effect.fork`                                                      | `Effect.forkChild`                               | forkScoped / forkIn unchanged; accept `{ startImmediately, uninterruptible }` | 9993  |
| `Effect.forkDaemon`                                                | `Effect.forkDetach`                              | -                                                                             | 9997  |
| `Effect.timeoutFail / timeoutTo`                                   | `Effect.timeoutOrElse`                           | -                                                                             | 10147 |
| `Effect.serviceOptional`                                           | `Effect.service (a key is itself an Effect)`     | -                                                                             | 10123 |
| `Effect.runtime + Runtime.runFork`                                 | `Effect.context + Effect.runForkWith(ctx)`       | Runtime<R> removed; also runPromiseWith, runSyncWith                          | 10105 |
| `Effect.withClock / withRandom / withConsole / withConfigProvider` | `Effect.provideService(effect, Clock.Clock, ..)` | services are Context.Reference values                                         | 10193 |
| `Effect.locally(fiberRef) / FiberRef.*`                            | `Effect.provideService(ref, v) / updateService`  | FiberRef -> Context.Reference (see below)                                     | 10037 |
| `Effect.partition -> [failures, successes]`                        | `Effect.partition -> [passes, fails]`            | same name, tuple order flipped                                                | 10083 |
| `Effect.all({ mode: "either" })`                                   | `Effect.all(xs, { mode: "result" })`             | allSuccesses / parallelErrors removed                                         | 9883  |

## Cause, Exit, Result, Option

| v3                                                                     | v4                                             | note                                                     | src   |
| ---------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------- | ----- |
| `Cause.isFailure / isDie / isInterrupted`                              | `Cause.hasFails / hasDies / hasInterrupts`     | Cause is a flat `reasons` array (no Sequential/Parallel) | 9079  |
| `Cause.failureOption / failureOrCause`                                 | `Cause.findErrorOption / findError`            | findError returns Result                                 | 9049  |
| `Cause.dieOption / interruptOption`                                    | `Cause.findDefect / findInterrupt`             | return Result, not Option                                | 9047  |
| `Cause.sequential / parallel`                                          | `Cause.combine`                                | -                                                        | 9115  |
| `Cause.TimeoutException (and NoSuchElement, IllegalArgument, Unknown)` | `Cause.TimeoutError (...Error)`                | guards: Cause.isTimeoutError                             | 9029  |
| `Either.left / right / isLeft / mapLeft`                               | `Result.fail / succeed / isFailure / mapError` | -                                                        | 10283 |
| `Exit.causeOption`                                                     | `Exit.getCause`                                | Exit.isFailure / isSuccess unchanged                     | 10459 |
| `Option.fromNullable / flatMapNullable`                                | `Option.fromNullishOr / flatMapNullishOr`      | repo also uses Option.fromUndefinedOr / fromNullOr       | 12860 |

## Ref, Deferred, Fiber, FiberRef, Runtime

| v3                                                                          | v4                                                                 | note                                                                    | src   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----- |
| `FiberRef.make / get / set / locally`                                       | `Context.Reference + Effect.provideService`                        | built-ins: FiberRef.currentLogLevel -> References.CurrentLogLevel       | 11233 |
| `FiberRef.currentConcurrency / Effect.withConcurrency`                      | pass `{ concurrency }` explicitly                                  | no ambient concurrency                                                  | 11243 |
| `Runtime.runFork(rt) / runPromise / runSync`                                | `Effect.runForkWith(ctx) / runPromiseWith / runSyncWith`           | Runtime module keeps only runMain/Teardown                              | 13608 |
| `unsafeX naming (Ref, Deferred, Queue, Chunk, Duration, DateTime, Context)` | `xUnsafe (Ref.makeUnsafe, Queue.offerUnsafe, DateTime.makeUnsafe)` | the suffix moved to the end everywhere                                  | 13454 |
| `Duration.decode / decodeUnknown / DurationInput`                           | `Duration.fromInputUnsafe / fromInput / Duration.Input`            | -                                                                       | 9779  |
| `Duration/DateTime/Order greaterThan, lessThan, between`                    | `isGreaterThan, isLessThan, isBetween`                             | -                                                                       | 9787  |
| `Predicate.isNullable / isNotNullable`                                      | `Predicate.isNullish / isNotNullish`                               | Predicate.isRecord -> isObject                                          | 13154 |
| `Array.isNonEmptyArray / isEmptyArray`                                      | `Array.isArrayNonEmpty / isArrayEmpty`                             | Array.fromNullable -> fromNullishOr                                     | 8857  |
| `Schedule.andThen / union / intersect`                                      | `Schedule.concat / min / max`                                      | also whileInput/untilOutput -> Schedule.while; repeatForever -> forever | 13958 |

## Stream

| v3                                                    | v4                                                | note                                  | src   |
| ----------------------------------------------------- | ------------------------------------------------- | ------------------------------------- | ----- |
| `Stream.catchAll / catchAllCause / tapErrorCause`     | `Stream.catch / catchCause / tapCause`            | -                                     | 15718 |
| `Stream.async / asyncPush / asyncScoped`              | `Stream.callback`                                 | -                                     | 15686 |
| `Stream.mapChunks / bufferChunks / runForEachChunk`   | `Stream.mapArray / bufferArray / runForEachArray` | chunks are now plain non-empty arrays | 15806 |
| `Stream.either / mergeEither`                         | `Stream.result / mergeResult`                     | -                                     | 15754 |
| `Stream.runScoped / runFoldScoped / runForEachScoped` | `Stream.run / runFold / runForEach`               | scope handling is built in            | 15938 |
| `Stream.repeatEffect / execute`                       | `Stream.fromEffectRepeat / fromEffectDrain`       | -                                     | 15874 |
| `Stream.provideLayer / provideSomeLayer`              | `Stream.provide`                                  | accepts a Layer or a Context          | 15862 |
| `Stream.timeoutFail / timeoutTo`                      | `Stream.timeoutOrElse`                            | -                                     | 15962 |

## Config

| v3                                                                | v4                                                                | note                                                                       | src  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- | ---- |
| `Config.string / number / boolean / port / url / date / duration` | `Config.String / Number / Boolean / Port / URL / Date / Duration` | PascalCase constructors; Config.withDefault / option / all / map unchanged | 9381 |
| `Config.integer / nonEmptyString / logLevel`                      | `Config.Int / NonEmptyString / LogLevel`                          | -                                                                          | 9351 |
| `Config.secret / redacted`                                        | `Config.Redacted`                                                 | Secret is gone                                                             | 9379 |
| `Config.literal("a", "b")`                                        | `Config.Literals(["a", "b"])`                                     | -                                                                          | 9353 |
| `Config.validate / branded / array / hashSet`                     | `Config.schema(Schema..., path)`                                  | validation lives in Schema                                                 | 9391 |
| `Config.mapOrFail / mapAttempt`                                   | `Config.mapEffect`                                                | -                                                                          | 9359 |
| `ConfigError (module)`                                            | `Config.ConfigError (class)`                                      | wraps SourceError or SchemaError                                           | 9405 |
| `ConfigProvider.fromJson / fromMap`                               | `ConfigProvider.fromUnknown`                                      | fromMap removed (expand to nested object); fromFlat -> make                | 9473 |

## Schema

| v3                                                                 | v4                                                                           | note                                                                                 | src   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----- |
| `Schema.decodeUnknown / decode / encode`                           | `Schema.decodeUnknownEffect / decodeEffect / encodeEffect`                   | sync variants (decodeSync, decodeUnknownSync) unchanged                              | 14814 |
| `Schema.decodeUnknownEither / decodeEither`                        | `Schema.decodeUnknownExit / decodeExit`                                      | repo also uses decodeUnknownOption                                                   | 14816 |
| `schema.annotations(..)`                                           | `schema.annotate(..)`                                                        | -                                                                                    | 14774 |
| `Schema.filter(pred) / refinement`                                 | `Schema.check(Schema.makeFilter(pred)) / Schema.refine`                      | -                                                                                    | 14854 |
| `minLength / maxLength / nonEmptyString / pattern / int / between` | `isMinLength / isMaxLength / isNonEmpty / isPattern / isInt / isBetween`     | apply with `.check(...)`; positive/nonNegative removed (isGreaterThan(0))            | 14942 |
| `Schema.UUID / ULID`                                               | `Schema.String.check(Schema.isUUID())`                                       | -                                                                                    | 14720 |
| `Schema.Union(A, B) / Tuple(A, B)`                                 | `Schema.Union([A, B]) / Tuple([A, B])`                                       | variadic -> array                                                                    | 14740 |
| `Schema.Literal("a", "b")`                                         | `Schema.Literals(["a", "b"])`                                                | Literal(null) -> Schema.Null                                                         | 14406 |
| `Schema.Record({ key, value })`                                    | `Schema.Record(key, value)`                                                  | -                                                                                    | 14560 |
| `Schema.optionalWith(s, { exact: true })`                          | `Schema.optionalKey(s)`                                                      | `Schema.optional(s)` also accepts undefined; defaults: Schema.withDecodingDefaultKey | 14980 |
| `Schema.transform / transformOrFail / compose`                     | `s.pipe(Schema.decodeTo(to, SchemaTransformation.transform({..})))`          | getters in effect/SchemaGetter                                                       | 15038 |
| `Schema.pick / omit / partial / extend`                            | `schema.mapFields(Struct.pick([..]) / omit / map(Schema.optional) / assign)` | Struct from effect/Struct                                                            | 14992 |
| `Schema.parseJson(s)`                                              | `Schema.fromJsonString(s)`                                                   | -                                                                                    | 14982 |
| `*FromSelf (DateFromSelf, OptionFromSelf, ...)`                    | `drop the suffix: Schema.Date, Schema.Option, ...`                           | v3 Schema.Date (ISO string) is now Schema.DateFromString                             | 14254 |
| `Schema.DateTimeUtc (string codec)`                                | `Schema.DateTimeUtcFromString`                                               | DateTimeUtcFromSelf -> DateTimeUtc; FromNumber -> FromMillis                         | 14260 |
| `Schema.Redacted(s)`                                               | `Schema.RedactedFromValue(s)`                                                | RedactedFromSelf -> Schema.Redacted                                                  | 14564 |
| `typeSchema / encodedSchema / asSchema`                            | `Schema.toType / toEncoded / revealCodec`                                    | Schema.validate* removed: decode against toType(schema)                              | 15048 |
| `Schema.TaggedError<Self>()("Tag", fields)`                        | unchanged                                                                    | same call shape; instances are yieldable errors                                      | 14654 |

## HTTP, API and SQL

| v3                                                                                  | v4                                                                                      | note                                                                               | src   |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----- |
| `HttpApiEndpoint.get("name") with a tagged-template path`                           | `HttpApiEndpoint.get("name", "/path/:id", { params, query, payload, success, error })`  | schemas move into the options object; path -> params, urlParams -> query           | 6811  |
| `HttpApiMiddleware.Tag<Self>()("X", { failure, provides })`                         | `HttpApiMiddleware.Service<Self, { requires?, provides? }>()("X", { error, security })` | `failure` -> `error`; group-level `.addError` removed: declare errors per endpoint | 6891  |
| `HttpApiBuilder.api(Api) / httpApp / toWebHandler`                                  | `HttpApiBuilder.layer(Api) + HttpRouter.serve / toWebHandler`                           | -                                                                                  | 6725  |
| `HttpServer.layerContext, NodeHttpServer.layerContext`                              | `HttpServer.layerServices, NodeHttpServer.layerHttpServices`                            | -                                                                                  | 7305  |
| `HttpClient.catchAll`                                                               | `HttpClient.catch`                                                                      | -                                                                                  | 7055  |
| `HttpServerResponse.unsafeJson / unsafeSetCookie, HttpClientRequest.bodyUnsafeJson` | `jsonUnsafe / setCookieUnsafe / bodyJsonUnsafe`                                         | -                                                                                  | 7369  |
| `SqlSchema.single`                                                                  | `SqlSchema.findOne`                                                                     | findOneOption / findAll / void unchanged                                           | 8105  |
| `Logger.minimumLogLevel / withMinimumLogLevel`                                      | `Layer.succeed(References.MinimumLogLevel, level)`                                      | Logger.add/replace -> Logger.layer([..]); prettyLogger -> consolePretty            | 11918 |

## Same name, different behavior (nothing fails to compile)

- `Ref`, `Deferred`, `Fiber` are plain values, not Effects: `Ref.get(ref)`, `Deferred.await(d)`, `Fiber.join(f)` (yieldable.md).
- `Option` and `Result` are not Effects: use `Effect.fromOption(o)` / `Effect.fromResult(r)`, never `yield* option`.
- `Config.*` and `Context.Service` classes are still Effects: `yield* Config.String("X")`, `yield* MyService`.
- `Exit` is an Effect; `Exit.isSuccess/isFailure` are unchanged.
- `Effect.try`: the callback form fails with `Cause.UnknownError`; a custom error needs `{ try, catch }` (v3-to-v4.md:10159).
- `Schema.NumberFromString` coerces like `Number(s)`: `"abc"` -> `NaN`, `""` -> `0`; `Schema.FiniteFromString` rejects (v3-to-v4.md:14494).
- Layers are memoized across separate `Effect.provide` calls by default (layer-memoization.md).
- Fibers waiting on callbacks keep the process alive; `runMain` is still recommended (fiber-keep-alive.md).
- `Cause` is a flat `reasons` array of Fail/Die/Interrupt; there is no tree and no `Empty` node (cause.md).
- `Stream` batches are plain non-empty arrays, not `Chunk`s (`mapArray`, `runForEachArray`).

## Avoid

- `Effect.Service`, `Effect.Tag`, `Context.Tag`, `Effect.catchAll` and the v3 packages `@effect/platform`, `@effect/sql`, `@effect/rpc`, `@effect/cli` in new code.
- `Runtime<R>`, `FiberRef`, `Secret`, `Schema.validate*`, `Data.struct`, `Mailbox`: removed; use the replacements above.
