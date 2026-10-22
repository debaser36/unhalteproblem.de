# Effect pattern: HttpApi (contract, handlers, client)

> Derived from repos/effect at effect@4.0.5 (subtree 7c94a19, upstream bc07bd4e8), 2026-10-21.
> Re-generate with `/effect-patterns http-api` after `/effect-update`.

Everything in `effect/http-api` (and `AtomHttpApi`) is `@stability unstable`: it
may break in minor releases. Change `lib/api` only through the `api-contract` agent.

## Imports

```ts
import { Schema, Context, Effect, Layer } from "effect";
import {
  HttpApi,
  HttpApiGroup,
  HttpApiEndpoint,
  HttpApiSchema,
  HttpApiSecurity,
  HttpApiMiddleware,
  HttpApiBuilder,
  HttpApiClient,
  HttpApiTest,
  OpenApi,
} from "effect/http-api";
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  FetchHttpClient,
} from "effect/http";
import { AtomHttpApi } from "effect/reactivity"; // website client
```

Definitions (lib/api) import only `effect`; handlers live in `services/backend/src/http/`.

## Core constructors and combinators

- `HttpApi.make(id).add(Group)...annotateMerge(OpenApi.annotations({...}))`, `extends` it as a class.
- `HttpApiGroup.make(name).add(...endpoints).middleware(M).annotateMerge(...)`. `add` is variadic.
- `HttpApiEndpoint.get|post|put|patch|delete(identifier, "/path/:p", { params, query, payload, success, error })`
  - `error` is one schema, an array, or `[]`. There is no `addError`/`addSuccess`.
  - `.middleware(M)` on an endpoint or a group; `.annotateMerge(OpenApi.annotations({ summary, description }))`.
- `HttpApiSchema`: `NoContent` (204), `Accepted` (202), `Empty(status)`, `WithHeaders`, `status(n)`,
  `asUint8Array`, `asMultipartStream({ maxParts, maxFileSize, maxTotalSize })`.
- `HttpApiMiddleware.Service<Self, { provides?, requires? }>()(id, { error, security?, requiredForClient? })`.
- `HttpApiSecurity.apiKey({ in: "cookie", key })`, `.bearer`, `.annotate(OpenApi.Description, "...")`.
- `HttpApiBuilder.group(Api, "name", Effect.fn(function* (handlers) {...}))`, `handlers.handle("id", fn)`
  (chainable) or `handlers.handleAll({ id: fn })`; `HttpApiBuilder.layer(Api)`.
- `HttpApiClient.make(Api, { baseUrl })`, `HttpApiClient.urlBuilder(Api, { baseUrl })`,
  `HttpApiTest.groups(Api, ["group"])`.

## Common patterns

Public endpoint, 202 without body, one error (lib/api).
Source: lib/api/src/groups/Contact.ts (adapted from repos/effect/ai-docs/src/51_http-server/fixtures/api/Users.ts)

```ts
export class ContactGroup extends HttpApiGroup.make("contact")
  .add(
    HttpApiEndpoint.post("submit", "/contact", {
      payload: ContactMessage,
      success: HttpApiSchema.Accepted,
      error: RateLimited,
    }).annotateMerge(
      OpenApi.annotations({ summary: "Send a contact message" }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "Contact" })) {}
```

Params, query, status 201, array of errors.
Source: lib/api/src/groups/Blogs.ts, BlogEditor.ts

```ts
HttpApiEndpoint.get("getPost", "/blogs/:blog/posts/:post", {
  params: { blog: BlogSlug, post: PostSlug }, // field record or schema; `:name` must match a field
  query: PostPageQuery,
  success: PublishedPost,
  error: [BlogNotFound, PostNotFound],
});
const CreatedPost = Schema.Union([ManagedPost]).pipe(HttpApiSchema.status(201)); // keeps one OpenAPI component
```

Error with status: a `Schema.TaggedError` whose 3rd argument carries `httpApiStatus`.
Source: lib/api/src/errors/BlogNotFound.ts, repos/effect/ai-docs/src/51_http-server/fixtures/api/Authorization.ts

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

Middleware definition: a security scheme, a provided service and an error.
Source: lib/api/src/Authentication.ts, SameOrigin.ts

```ts
export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentUser }
>()("@unhalteproblem.de/api/Authentication", {
  error: Unauthorized,
  security: { session: SessionSecurity },
}) {}
export class SameOrigin extends HttpApiMiddleware.Service<SameOrigin>()(
  "@unhalteproblem.de/api/SameOrigin",
  { error: Forbidden },
) {}
```

Order: `.middleware(X)` on a group applies to the endpoints added before it, and a later
call runs before earlier ones. So `Authentication` goes last on the group and answers 401
before any endpoint-level 403 middleware. `requiredForClient` stays false for cookies.

Middleware implementation (backend): one layer per middleware. With `security`, the member
is named after the scheme and gets `(httpEffect, { credential })`; without, it is the function.
Source: services/backend/src/http/Authentication.ts, SameOrigin.ts, auth/Authorization.ts

```ts
Layer.effect(Authentication, Effect.gen(function* () {
  const access = yield* SessionAccess;
  return Authentication.of({
    session: (httpEffect, { credential }) => Effect.gen(function* () {
      const found = yield* access.find(hashSecret(Redacted.value(credential))).pipe(Effect.orDie);
      if (Option.isNone(found)) return yield* new Unauthorized();
      return yield* Effect.provideService(httpEffect, CurrentUser, toSessionInfo(found.value));
    }),
  });
}));
Layer.succeed(RequireAdmin, (httpEffect) => /* check, then Effect.provideService(httpEffect, proof, value) */);
```

Path params inside a middleware: `yield* HttpRouter.params`. Request: `HttpServerRequest.HttpServerRequest`.

Handlers: the handler argument is `{ params, query, payload, request }`.
Source: services/backend/src/http/Blogs.ts, Contact.ts, System.ts

```ts
export const ContactHandlers = HttpApiBuilder.group(
  Api,
  "contact",
  Effect.fn(function* (handlers) {
    const commands = yield* ContactCommands; // dependencies are resolved once, here
    return handlers.handle("submit", ({ payload, request }) =>
      rateLimit.consume(clientKey(request)).pipe(
        Effect.catchTag("ContactRateLimitExceeded", () =>
          Effect.fail(new RateLimited()),
        ),
        Effect.andThen(commands.submit(payload)),
      ),
    );
  }),
);
```

Handler errors must be declared in the contract; turn the rest into defects (`Effect.orDie`,
`Effect.catchTag("X", Effect.die)`). Read a middleware-provided service with
`yield* Effect.service(CurrentUser)`.

Custom response: set cookies and headers, redirect, multipart upload.
Source: services/backend/src/http/Account.ts, Auth.ts, Upload.ts, lib/api/src/MediaUpload.ts

```ts
yield *
  HttpEffect.appendPreResponseHandler((_req, res) =>
    Effect.succeed(
      res.pipe(
        HttpServerResponse.expireCookieUnsafe(SessionCookie, cookieOptions),
      ),
    ),
  );
HttpServerResponse.redirect(url, { status: 302 }).pipe(
  HttpServerResponse.setCookieUnsafe(name, value, opts),
);
// contract: Schema.Struct({ file: Multipart.SingleFileSchema }).pipe(HttpApiSchema.asMultipartStream({ maxParts: 1, ... }))
// handler: payload is Stream<Multipart.Part, MultipartError>; read it only after the authorization check
```

A redirect endpoint documents `success: HttpApiSchema.WithHeaders(HttpApiSchema.Empty(302))` and the handler returns the `HttpServerResponse`.

Serve (backend). Source: services/backend/src/Server.ts

```ts
const ApiRoutes = HttpApiBuilder.layer(Api).pipe(Layer.provide(Handlers)); // Handlers also needs the middleware layers
export const Server = HttpRouter.serve(
  Layer.mergeAll(ApiRoutes, RequestLogging),
  { disableLogger: true },
).pipe(Layer.provide([HttpServerLive, MaxBodySizeLive]));
```

Docs routes (not used here): `HttpApiBuilder.layer(Api, { openapiPath })`, `HttpApiScalar.layer(Api, { path })` (ai-docs 51_http-server/10_basics.ts).

Client in the website: atoms. Source: services/web/src/api/ApiClient.ts, features/projects/projectAtoms.ts, features/contact/ContactPage.tsx

```ts
export class ApiClient extends AtomHttpApi.Service<ApiClient>()(
  "@unhalteproblem.de/website/ApiClient",
  {
    api: Api,
    httpClient: FetchHttpClient.layer,
    baseUrl: new URL("/api", window.location.origin).href,
  },
) {}
export const projectAtom = (project: string) =>
  ApiClient.query("projects", "getProject", {
    params: { project },
    reactivityKeys: ["projects"],
  });
const submitContact = ApiClient.mutation("contact", "submit");
const submit = useAtomSet(submitContact, { mode: "promiseExit" }); // @effect/atom-react
const exit = await submit({ payload: { name, email, message } });
```

Plain Effect client: `const client = yield* HttpApiClient.make(Api, { baseUrl })`, then
`client.group.endpoint({ params, query, payload })`; no-arg endpoints: `client.health()`.
`HttpApiClient.urlBuilder(Api, { baseUrl })` builds URLs for endpoints you navigate to (login redirects).
Source: services/backend/src/auth/OidcProvider.ts, repos/effect/ai-docs/src/51_http-server/10_basics.ts

## Error handling

- Declared errors arrive typed on the client: `Effect.flip` then `error._tag`, or `errorTag(cause)` on the website
  (services/web/src/api/errors.ts).
- Request validation failures (params, query, payload) are answered with 400 by the framework; do not declare them.
- Built-in errors (`HttpApiError.*`, unstable) can be yielded like any `Schema.TaggedError`.
- `Effect.catchReason(tag, reason, ...)` and `Effect.catchReasons` unwrap nested error reasons
  (repos/effect/ai-docs/src/51_http-server/fixtures/server/Users/http.ts).

## Testing

`HttpApiTest.groups` is a typed in-memory client over the handlers, which must come with every middleware
of the API (use `MiddlewaresRejectAll` for groups that use none).
Source: services/backend/src/http/System.test.ts, testing/Authentication.ts, repos/effect/ai-docs/src/51_http-server/20_testing.ts

```ts
const makeClient = HttpApiTest.groups(Api, ["system"]);
const flow = Effect.gen(function* () {
  const client = yield* makeClient;
  const error = yield* client.ready().pipe(Effect.flip);
  assert.instanceOf(error, ServiceUnavailable);
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      SystemHandlers,
      HttpServer.layerServices,
      MiddlewaresRejectAll,
    ),
  ),
);
```

Full pipeline with a cookie/Origin: `makeApp()` in services/backend/src/testing/App.ts (web handler, in-memory Postgres).

## v3 → v4 differences (old spelling → new spelling)

Source: repos/effect/migration/v3-to-v4.md, sections `@effect/platform/HttpApi*`

- `@effect/platform` `HttpApi*` → `effect/http-api`; `HttpServer`/router → `effect/http`.
- `HttpApiEndpoint.get("id")` + `.addSuccess/.addError/.setPayload/.setUrlParams` and tagged-template paths →
  `get(id, path, { params, query, payload, success, error })`; `urlParams` → `query`, `path` → `params`.
- `HttpApiMiddleware.Tag` → `HttpApiMiddleware.Service`; failure → `error`.
- `HttpApi.make(...).addError(...)` and group-level errors are gone: declare per endpoint or in a middleware.
- `HttpApiBuilder.api(Api)` → `HttpApiBuilder.layer(Api)`; `HttpApiBuilder.toWebHandler`, `middlewareCors`,
  `httpApp` → `HttpRouter.toWebHandler`, `HttpRouter.cors`, `HttpRouter.toHttpEffect`.
- `HttpApiSchema.Multipart(s)` → `s.pipe(HttpApiSchema.asMultipart(opts))`; `HttpApiSchema.param` → `params` option.
- `HttpApiSchema.annotations({ status })` → `httpApiStatus` annotation (or `HttpApiSchema.status(n)`);
  `withEncoding` → `asJson`/`asText`/`asUint8Array`.
- `HttpApiError.Forbidden` (empty body) → `ForbiddenNoContent`; `Forbidden` now has a JSON body.
- Client call shape: `{ path, urlParams, payload }` → `{ params, query, payload }`; `Context.Tag` → `Context.Service`.

## Avoid

- Importing handlers or backend code into `lib/api`, or `repos/` paths anywhere.
- Renaming a group or endpoint identifier: it is the generated client's method name (breaking).
- Declaring `RequireRoles`/`Authorized` proofs outside `#auth/Authorization`.
- `SameOrigin` on GET endpoints; forgetting it on cookie-authenticated POST/PUT/PATCH/DELETE.
- Reading an upload stream before the authorization check; v3 spellings (`addSuccess`, `Middleware.Tag`, `urlParams`).
