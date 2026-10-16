---
name: effect-service
description: Scaffold a new Effect v4 backend service at services/<name> with a fixed structure (NodeRuntime entry, Config, Layers, HttpApi handlers for the shared lib/api contract, OpenTelemetry-ready logging, @effect/vitest tests). Use when the user asks to create or bootstrap a new backend service.
disable-model-invocation: true
argument-hint: "<service-name>"
---

Scaffold `services/$ARGUMENTS` as an Effect v4 HTTP service. Every service in
this repo uses the same structure. Keep the scaffold minimal and add features
only on request.

## 0. Preconditions

- `$ARGUMENTS` must be kebab-case, and `services/$ARGUMENTS` must not exist.
- **Effect v4 must be installed.** If `pnpm-workspace.yaml` pins
  `effect: ^3…`, stop. Tell the user the scaffold uses v4 APIs (`effect/http`,
  `effect/http-api`, `effect/sql`). Don't scaffold v3 code instead.
- Read `CLAUDE.md`, and any `agent-patterns/effect-*.md` files.

## 1. Ground the code in the vendored docs

Before writing code, ask the `effect-researcher` agent for the current v4
wiring. The reference files are:

- `repos/effect/ai-docs/src/01_effect/06_running/` (`runMain`,
  `Layer.launch`)
- `repos/effect/ai-docs/src/51_http-server/10_basics.ts` and `fixtures/server/`
  (`HttpApiBuilder.group`, `HttpApiBuilder.layer`, `HttpRouter.serve`,
  `NodeHttpServer.layer`)
- `repos/effect/ai-docs/src/51_http-server/20_testing.ts` (`HttpApiTest`)
- `repos/effect/ai-docs/src/08_observability/` (logging, OTLP tracing)
- `repos/effect/ai-docs/src/01_effect/03_services/` (services and Layers)

## 2. Contract first

The service implements groups from the shared contract `lib/api`
(`@unhalteproblem.de/api`). If `lib/api` doesn't exist yet, or lacks a group
for this service, delegate to the `api-contract` agent first. Ask it to create
or extend the contract, at minimum with a `system` group containing a
`health` endpoint. Never define the API inside the service.

## 3. Files

```
services/<name>/
├── package.json
├── tsconfig.json              # extends @unhalteproblem.de/tsconfig/tsconfig.base.json, noEmit
└── src/
    ├── main.ts                # Layer.launch(Server).pipe(NodeRuntime.runMain); nothing else
    ├── Server.ts              # HttpApiBuilder.layer(Api) + HttpRouter.serve + NodeHttpServer.layer
    ├── Config.ts              # all settings via Config (PORT, HOST, …); secrets via Config.Redacted
    ├── http/<Group>.ts        # one HttpApiBuilder.group(...) handler Layer per contract group
    ├── http/<Group>.test.ts   # @effect/vitest + HttpApiTest against in-memory service Layers
    └── services/<Name>.ts     # domain services: Context.Service + Layer, one per file
```

Tests sit next to the code they test, so they import it with same-folder
relative paths (`./System.ts`) and everything else through aliases. There is
no separate `test/` folder.

In development the service runs from source with Node's built-in type
stripping (Node comes from the flake), like `lib/api`. That needs
`verbatimModuleSyntax` and `erasableSyntaxOnly` (no enums, no parameter
properties, no namespaces). `tsc` never emits: the aliases point at
`./src/*.ts`, so compiled output would load the sources anyway.

For deployment, `build` bundles `src/main.ts` with rolldown into one
self-contained `dist/main.js`. That bundle is the only thing the container
image needs besides Node. Running the sources in production would not work:
Node refuses to strip types under `node_modules`, where a deployed copy of
`@unhalteproblem.de/api` would live.

`package.json`:

- `"name": "@unhalteproblem.de/<name>"`, `"private": true`, `"type": "module"`
- `imports`, following "Imports and path aliases" in `CLAUDE.md`. One alias
  per folder, and one single-file alias for each file directly in `src/` that
  other folders import:
  ```json
  "imports": {
    "#Config": "./src/Config.ts",
    "#http/*": "./src/http/*.ts",
    "#services/*": "./src/services/*.ts"
  }
  ```
  Add `#Server` only if something besides `main.ts` imports it. Add the alias
  for every new folder in the same change.
- scripts:
  - `dev`: `node --watch src/main.ts`
  - `build`: `rolldown src/main.ts --platform node --format esm --file dist/main.js`
  - `start`: `node dist/main.js`
  - `check-types`: `tsc --noEmit -p .`
  - `lint`: `oxlint`
  - `test`: `vitest run`
- dependencies, all `catalog:` except the workspace packages: `effect`,
  `@effect/platform-node`, `@unhalteproblem.de/api` (`workspace:*`)
- devDependencies: `@unhalteproblem.de/tsconfig` (`workspace:*`),
  `typescript`, `@types/node`, `vitest`, `@effect/vitest`, `@effect/tsgo`,
  `oxlint`, and `rolldown` (the version already in `pnpm-lock.yaml` through
  Vite; move it to the catalog once a second service uses it)

`tsconfig.json`: copy `lib/api/tsconfig.json` (`noEmit`, no declarations,
`allowImportingTsExtensions`, `verbatimModuleSyntax`, `erasableSyntaxOnly`)
and add `"types": ["node"]`. The base already sets `lib` and allows the
unstable modules the backend is built on (`effect/http`, `effect/http-api`,
`effect/sql`, `@effect/platform-node`, `@effect/sql-pg`, `@effect/vitest`).
If the service needs another unstable module, repeat the base's whole
`allowedUnstableApis` list plus the new entry, because a package's own list
replaces the base's.

Rules for the code:

- Copy wiring from the vendored examples above, adapted to package imports.
  Never import from `repos/`.
- Imports across folders go through the `#` aliases, never `../`. The
  contract is imported by package name (`@unhalteproblem.de/api`).
- No `Effect.runPromise`/`runSync` anywhere except through
  `NodeRuntime.runMain` in `main.ts`.
- Handlers stay thin. They decode via the contract, call services, and map
  domain errors to the contract's error schemas.
- Read configuration only in `Config.ts`.

## 4. Wire it into the repo

- Run `pnpm install`. The lockfile change is expected.
- Turborepo picks the package up through the `services/*` glob. If the
  service reads env vars at build or test time, add them to the matching task's
  `env` in `turbo.json`.
- Document the service's env vars in a short `services/<name>/README.md`.

## 5. Verify

Run `pnpm --filter @unhalteproblem.de/<name> check-types`, then `lint`, then
`test`, then `build`. After that, run `start` (the bundle) briefly and `curl`
the health endpoint. Then
ask the `effect-reviewer` agent to review the new package and address its
findings. Report the created files and every command's result.
