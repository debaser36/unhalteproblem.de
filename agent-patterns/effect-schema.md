# Effect pattern: Schema

> Derived from repos/effect at effect@4.0.5 (subtree 7c94a19, upstream bc07bd4e8), 2026-10-21.
> Re-generate with `/effect-patterns schema` after `/effect-update`.

Tagged error classes (`Schema.TaggedError`) are covered in `effect-errors.md`.

## Imports

```ts
import { Schema, SchemaGetter, Effect, Exit } from "effect";
import { Model } from "effect/schema"; // @stability unstable
import { HttpApiSchema } from "effect/http-api"; // @stability unstable
```

## Core constructors and combinators

- Primitives: `Schema.String`, `Number`, `Int`, `Boolean`, `Trimmed`, `Null`,
  `DateTimeUtc` (the self schema; `FromSelf` suffixes are gone).
- `Schema.Struct({...})`, `Schema.Array(s)`, `Schema.NonEmptyArray(s)`,
  `Schema.Record(key, value)`, `Schema.Tuple([a, b])`.
- Unions take arrays: `Schema.Union([A, B])`, `Schema.Literals(["a", "b"])`;
  a single literal is `Schema.Literal("a")`.
- Constraints are filters: `s.check(Schema.isNonEmpty(), Schema.isMaxLength(n),
Schema.isPattern(re, { expected }), Schema.isBetween({ minimum, maximum }),
Schema.isUUID())`. `.check(...)` takes several at once.
- `Schema.brand("X")` after `.check`; `.annotate({ identifier, description })`
  names a schema in OpenAPI; `.annotateKey({...})` documents a struct field.
- Fields: `Schema.optionalKey(s)` (key may be absent, no `undefined`),
  `Schema.NullOr(s)`, `Schema.OptionFromNullOr(s)` (DB nullable column ->
  `Option`), `Schema.withDecodingDefaultKey(Effect.succeed(x))`.
- Transform: `from.pipe(Schema.decodeTo(to, { decode, encode }))` with
  `SchemaGetter.transform(fn)`; `Schema.toType(s)` keeps only the Type side.
- Codecs: `Schema.fromJsonString(s)`, `Schema.StringFromBase64Url`,
  `Schema.DateTimeUtcFromDate` (Date <-> DateTime.Utc),
  `Schema.DateTimeUtcFromMillis`.
- Classes: `Schema.Class`, `Schema.TaggedClass`, `Model.Class` (@stability unstable).
- Recursion: `Schema.suspend((): Schema.Codec<T> => Self)`.
- Run: `Schema.decodeUnknownExit(s)(u)` (pure, returns `Exit`),
  `decodeUnknownEffect`, `decodeSync`/`encodeSync` (throw), `decodeUnknownOption`.
  Effect forms fail with `Schema.SchemaError` (`Schema.isSchemaError`).

## Common patterns

### Branded id (UUID)

```ts
export const UserId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("UserId"),
);
export type UserId = typeof UserId.Type;
```

Source: services/backend/src/domains/users/User.ts. With OpenAPI metadata:
lib/api/src/domain/Media.ts (`.annotate({ identifier: "MediaId", ... })`).

### Validated text instead of trimming during decode

```ts
export const BlogTitle = Schema.Trimmed.check(
  noNul, // Schema.isPattern(...) from #domain/Text
  Schema.isNonEmpty(),
  Schema.isMaxLength(BlogLimits.blogTitleMaxLength),
).annotate({ identifier: "BlogTitle", description: "..." });
export type BlogTitle = typeof BlogTitle.Type;
```

Source: lib/api/src/domain/Blog.ts. A pattern must use the `u` flag to export
to JSON Schema (lib/api/src/domain/Text.ts, `slugString`).

### Domain events: `Schema.TaggedClass`

```ts
export class PostPublished extends Schema.TaggedClass<
  PostPublished,
  { readonly brand: unique symbol }
>()("PostPublished", { blog: BlogSlug, postId: PostId, by: UserId }) {}
```

Source: services/backend/src/domains/blogs/Blog.ts. The `Self` generic is
required (without it the type is `MissingSelfGeneric`); the `{ brand }` second
generic makes instances nominal. Construct with `new PostPublished({...})`.

### Database model: `Model.Class` (@stability unstable)

```ts
export class User extends Model.Class<User>("User")({
  id: UserId,
  subject: Subject.pipe(Model.FieldExcept(["update", "jsonUpdate"])),
  email: Schema.OptionFromNullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromDate.pipe(
    Model.FieldExcept(["update", "jsonUpdate"]), // never written after insert
  ),
  updatedAt: Schema.DateTimeUtcFromDate,
}) {}
```

Source: services/backend/src/domains/users/User.ts. `Model.Class` derives the
variants `select`, `insert`, `update`, `json`, `jsonCreate`, `jsonUpdate`.
`Model.FieldExcept([...])` leaves a field out of those variants. A field with
a different shape per variant:
`Model.Field({ select: Document, insert: Schema.fromJsonString(Document), ... })`
(services/backend/src/repositories/Columns.ts). Build rows with `Row.make({...})`.

### Defaults and optional query keys

```ts
limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))
  .annotateKey({ description: "Page size, 1 to 50; 10 if absent." })
  .pipe(Schema.withDecodingDefaultKey(Effect.succeed(10))),
cursor: Schema.optionalKey(PostCursor).annotateKey({ description: "..." }),
```

Source: lib/api/src/domain/Blog.ts (`PostPageQuery`). Annotate the key before
the default: `withDecodingDefaultKey` returns a `decodeTo`.

### Opaque cursor: chain of `decodeTo`

```ts
export const PostCursor = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(PostCursorMaxLength)),
  Schema.decodeTo(Schema.StringFromBase64Url),
  Schema.decodeTo(
    Schema.fromJsonString(Schema.Tuple([Schema.DateTimeUtcFromMillis, PostId])),
  ),
  Schema.decodeTo(
    Schema.Struct({
      publishedAt: Schema.DateTimeUtc,
      id: Schema.toType(PostId),
    }),
    {
      decode: SchemaGetter.transform(([publishedAt, id]) => ({
        publishedAt,
        id,
      })),
      encode: SchemaGetter.transform(
        ({ publishedAt, id }) => [publishedAt, id] as const,
      ),
    },
  ),
);
```

Source: lib/api/src/domain/Blog.ts (`PostCursor`).

### Whitelist schema for untrusted rich text (Document)

Unknown node types and marks fail decoding, unknown struct keys are dropped,
and leaves reject `content` instead of silently losing children:

```ts
const noContent = Schema.optionalKey(Schema.Never);
const content = Schema.optionalKey(
  Schema.Array(Schema.suspend((): Schema.Codec<DocumentNode> => DocumentNode)),
);
const leaf = <const Type extends string, Fields extends Schema.Struct.Fields>(
  type: Type,
  identifier: string,
  fields: Fields,
) =>
  Schema.Struct({
    type: Schema.Literal(type),
    ...fields,
    content: noContent,
  }).annotate({ identifier });

export const DocumentNode: Schema.Codec<DocumentNode> = Schema.Union([
  container("paragraph", "ParagraphNode", {
    attrs: Schema.optionalKey(ParagraphAttrs),
  }),
  leaf("image", "ImageNode", { attrs: ImageAttrs }),
  // ...
]);
```

Source: lib/api/src/domain/Document.ts. Recursive unions need an explicit
`Schema.Codec<T>` annotation plus a hand-written `type DocumentNode = ...`.
Optional attributes: `Schema.optionalKey(Schema.NullOr(s))` (`optionalAttr`).
Safe URLs: `Schema.String.check(Schema.isPattern(MEDIA_URL_PATTERN, { expected }))`.

## Error handling

- `decodeUnknownEffect` fails with `Schema.SchemaError`; its message quotes the
  offending value, so keep it out of logs and responses (see `effect-errors.md`).
- `HttpApi` turns payload/query/param decode failures into HTTP 400 itself.

## Testing

```ts
const decode = Schema.decodeUnknownExit(Document);
assert.deepStrictEqual(decode(emptyDocument), Exit.succeed(emptyDocument));
assert.isTrue(Exit.isFailure(decode(badDocument)));
// round trip: Schema.encodeSync(S)(Schema.decodeSync(S)(encoded)) equals encoded
```

Source: lib/api/src/domain/Document.test.ts, lib/api/src/domain/Admin.test.ts.

## v3 -> v4 differences (old spelling -> new spelling)

- `Schema.Union(A, B)` / `Literal("a", "b")` / `Tuple(A, B)` -> `Union([A, B])` / `Literals(["a", "b"])` / `Tuple([A, B])`
- `Schema.Record({ key, value })` -> `Schema.Record(key, value)`
- `Schema.annotations(x)` -> `.annotate(x)`; `compose` -> `decodeTo`; `typeSchema` -> `toType`; `encodedSchema` -> `toEncoded`
- `filter(pred)` -> `check(makeFilter(pred))`; `pattern`/`minLength`/`nonEmptyString` -> `check(isPattern(..))`/`isMinLength`/`isNonEmpty()`
- `Schema.UUID` -> `Schema.String.check(Schema.isUUID())`
- `decodeUnknown` / `decode` / `decodeUnknownEither` -> `decodeUnknownEffect` / `decodeEffect` / `decodeUnknownExit`
- `optionalWith({ exact: true })` -> `optionalKey(s)`; `optionalWith({ default })` -> `withDecodingDefault*`; `optional(s)` now also allows `undefined`
- `Schema.Date`, `DateTimeUtc` (string codecs) -> `DateFromString`, `DateTimeUtcFromString`; `DateFromSelf` -> `Date`
- `Schema.parseJson(s)` -> `Schema.fromJsonString(s)`; `Schema.Redacted` -> `RedactedFromValue`
- `Schema.TaggedError<Self>()("Tag", fields)` -> same call shape, second generic is the brand; `TaggedErrorClass` is gone
- `validate*` removed: decode, then `toType`

## Avoid

- Variadic `Union`/`Literal`, `Schema.compose`, `Schema.filter`, `parseJson`:
  v3 spellings.
- Free-form `Schema.String` fields stored in `text`/`jsonb`: add `noNul`
  (Postgres rejects NUL and unpaired surrogates).
