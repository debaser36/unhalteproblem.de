# Effect pattern: Errors

> Derived from repos/effect at effect@4.0.5 (subtree 7c94a19, upstream bc07bd4e8), 2026-10-21.
> Re-generate with `/effect-patterns errors` after `/effect-update`.

Model: expected failures (domain errors) live in the `E` channel and are
tagged; unexpected ones (bugs, infrastructure) are defects (`Effect.die`).

## Imports

```ts
import { Cause, Data, Effect, Exit, Schema } from "effect";
import { SqlError } from "effect/sql";
import { HttpApiSchema } from "effect/http-api"; // @stability unstable
```

## Core constructors and combinators

- Define: `Schema.TaggedError` (errors that cross the wire / need a schema),
  `Data.TaggedError("Tag")<{...}>` (internal errors, no schema).
  Instances are yieldable: `return yield* new MyError({...})`.
- Raise: `Effect.fail(e)`, `Effect.die(defect)`, `Effect.failCause(cause)`.
- Recover from typed errors: `Effect.catchTag(tag | [tags], f, orElse?)`,
  `Effect.catchTags({ Tag: f })`, `Effect.catchIf(predicate | refinement, f)`,
  `Effect.catch(f)` (all errors), `Effect.catchFilter(Filter, f)`,
  `Effect.catchReason(errorTag, reasonTag, f, orElse?)` (nested `reason`).
- Recover from the whole cause: `Effect.catchCause(f)`,
  `Effect.catchCauseIf(pred, f)`, `Effect.catchDefect(f)` (defects only).
- Convert: `Effect.orDie` (typed error -> defect), `Effect.mapError`,
  `Effect.catchNoSuchElement`, `Effect.orElseSucceed`.
- Observe: `Effect.tapError`, `Effect.tapCause`, `Effect.exit`,
  `Effect.result`, `Effect.flip` (error becomes the success value).
- `Cause`: `hasInterruptsOnly`, `findError` (returns a `Result`), `hasDies`,
  `squash`, `pretty`, `isNoSuchElementError`.

## Common patterns

### Contract error with an HTTP status

```ts
export class BlogNotFound extends Schema.TaggedError<
  BlogNotFound,
  { readonly brand: unique symbol }
>()(
  "BlogNotFound",
  { blog: BlogSlug },
  { httpApiStatus: 404, description: "No subblog with this slug exists." },
) {}
```

Source: lib/api/src/errors/BlogNotFound.ts. Shape: `TaggedError<Self, Brand>()(tag,
fields, annotations)`. The `Self` generic is mandatory. Error classes shared
with the API live in `lib/api/src/errors/`; domains re-export them
(services/backend/src/domains/blogs/Blog.ts). Endpoints list them:
`error: [BlogNotFound, PostNotFound]` or `error: []`
(lib/api/src/groups/Blogs.ts). Unlisted failures become 500.

### Error without a response body (status only)

```ts
error: ServiceUnavailable.pipe(
  HttpApiSchema.asNoContent({ decode: () => new ServiceUnavailable() }),
),
```

Source: lib/api/src/groups/System.ts (`HttpApiSchema` is @stability unstable).

### Internal error with a readable log message

```ts
export class MailFailed extends Schema.TaggedError<
  MailFailed,
  { readonly brand: unique symbol }
>()("MailFailed", {
  reason: Schema.String,
  detail: Schema.optionalKey(Schema.String),
}) {
  override get message() {
    return `SMTP failed (${this.reason})`;
  }
}
```

Source: services/backend/src/infrastructure/Mailer.ts (`message` getter shortened).
Marker errors without fields (`{}`) are fine
(services/backend/src/domains/contact/ContactRateLimit.ts). Keep secrets and user
data out of fields and `message`: they reach logs.

### Translate a database constraint into a domain error

```ts
transaction
  .run(save)
  .pipe(
    Effect.catchIf(isUniqueViolation(postSlugConstraint), () =>
      Effect.fail(new PostSlugTaken({ slug })),
    ),
  );
```

Source: services/backend/src/domains/blogs/BlogCommands.ts. Only inside a
savepoint (a nested `Transaction.run`), otherwise the transaction is dead.
`isUniqueViolation` checks `SqlError.isSqlError(e) && e.reason._tag ===
"UniqueViolation"` (services/backend/src/infrastructure/Columns.ts).

### Infrastructure errors become defects at the boundary

```ts
export const boundary = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.catchIf(self, isInfrastructureError, (error) =>
    Effect.die(scrubbed(error)),
  ) as Effect.Effect<A, Exclude<E, InfrastructureError>, R>;
// InfrastructureError = SqlError.SqlError | Schema.SchemaError
```

Source: services/backend/src/cqrs/Query.ts. The original error is replaced by
a message naming only the kind, because `SchemaError` and Postgres errors
quote the offending data. Callers then handle only domain errors.
Narrow a single tag away: `Effect.catchTag(self, "SchemaError", Effect.die)`
(services/backend/src/cqrs/Outbox.ts).

### Handle several tags, keep the rest

```ts
verifier.verifyIdToken(token, { nonce }).pipe(
  Effect.catchTags({
    InvalidToken: (e) => fail("failed", `invalid ID token: ${e.reason}`),
    KeysUnavailable: (e) =>
      Effect.logError("Provider keys unavailable").pipe(
        Effect.annotateLogs({ detail: e.reason }),
        Effect.andThen(fail("failed", "provider keys unavailable")),
      ),
  }),
);
```

Source: services/backend/src/http/Auth.ts. Other uses: `Effect.catchTag("BlogNotFound",
Effect.die)` when a case is impossible (services/backend/src/http/Blogs.ts);
`Effect.catchTag("BlogNotFound", () => Effect.fail(new PostNotFound({...})))` to
re-map (services/backend/src/http/BlogEditor.ts).

### Catch a nested reason (rate limiter)

```ts
limiter.consume({ key, limit, window }).pipe(
  Effect.asVoid,
  Effect.catchReason(
    "RateLimiterError",
    "RateLimitExceeded",
    () => Effect.fail(new ContactRateLimitExceeded()),
    // orElse: other reasons; here a broken store must not break the form
    (_, error) => Effect.logWarning("Rate limiter store failed", error),
  ),
);
```

Source: services/backend/src/domains/contact/ContactRateLimit.ts. Vendored example:
`Effect.catchReason("AiError", "RateLimitError", (r) => ...)` in
repos/effect Effect.ts JSDoc (new in v4).

### Last-resort handlers

`Effect.catchCauseIf((cause) => !Cause.hasInterruptsOnly(cause), (cause) =>
Effect.logWarning("Outbox pass failed", cause).pipe(Effect.as(0)))` keeps a
background loop alive but lets interruptions pass (services/backend/src/cqrs/Outbox.ts).
A page-navigation flow answers defects with a redirect via `Effect.catchDefect`
(services/backend/src/http/Auth.ts).

## Error handling

- Expected failure -> tagged error in `E`; invariant violation -> `Effect.die`.
- `Effect.fn("Name")(function* () {...}, pipeStage)`: extra arguments are pipe
  stages (`Query.boundary`). Defects reach the log and become HTTP 500.

## Testing

```ts
const exit = yield * Effect.exit(program);
assert.isTrue(Exit.isFailure(exit));
```

Source: services/backend/src/Config.test.ts. To assert on the typed error use
`Effect.flip` and check `_tag`; vendored tests for `catchTag`/`catchReason`:
repos/effect packages/effect/test/Effect.test.ts ("error handling",
"catchReason"). Pure schema failures: `Schema.decodeUnknownExit`
(see `effect-schema.md`).

## v3 -> v4 differences (old spelling -> new spelling)

- `Effect.catchAll` -> `Effect.catch`
- `Effect.catchAllCause` -> `Effect.catchCause`; `catchAllDefect` -> `catchDefect`
- `Effect.catchSome` -> `catchFilter` (with `Filter`), `catchSomeCause` -> `catchCauseFilter`;
- `catchTag`, `catchTags`, `catchIf` unchanged; new: `catchReason(s)`, `catchEager`
- `Effect.either` / `Either` -> `Effect.result` / `Result`
- `ParseResult.ParseError` (no v4 mapping documented) -> decode effects fail with `Schema.SchemaError` (`Schema.isSchemaError`)
- `Schema.TaggedError<Self>()(tag, fields)`: still `Schema.TaggedError`; the
  `TaggedErrorClass` helper type is gone

Details: migration/error-handling.md, migration/cause.md in the vendored repo.

## Avoid

- Catching `SqlError` outside a savepoint (dead transaction).
- Letting `SchemaError` or raw `SqlError` reach logs/responses: the message
  contains the data.
- `Schema.TaggedError` without the `Self` generic.
