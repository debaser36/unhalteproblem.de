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
- **Effect v4 must be installed.** If `pnpm-workspace.yaml` still pins
  `effect: ^3…`, stop. Tell the user the scaffold uses v4 APIs (`effect/http`,
  `effect/http-api`, `effect/sql`) and needs the planned v4 migration first.
  Don't scaffold v3 code instead.
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
├── tsconfig.json          # extends @unhalteproblem.de/tsconfig/tsconfig.base.json (src only)
├── tsconfig.test.json     # same base, rootDir "${configDir}", include src + test, noEmit
├── vitest.config.ts
├── src/
│   ├── main.ts            # Layer.launch(HttpServerLive).pipe(NodeRuntime.runMain); nothing else
│   ├── Server.ts          # HttpApiBuilder.layer(Api) + HttpRouter.serve + NodeHttpServer.layer
│   ├── Config.ts          # all settings via Config (PORT, HOST, …); secrets via Config.Redacted
│   ├── http/<Group>.ts    # one HttpApiBuilder.group(...) handler Layer per contract group
│   └── services/          # domain services: Context.Service + Layer, one per file
└── test/
    └── http.test.ts       # @effect/vitest + HttpApiTest against in-memory service Layers
```

`package.json`:

- `"name": "@unhalteproblem.de/<name>"`, `"private": true`, `"type": "module"`
- scripts:
  - `dev`: `tsx watch src/main.ts`
  - `build`: `tsc -b`
  - `start`: `node dist/main.js`
  - `check-types`: `tsc --noEmit -p tsconfig.test.json`
  - `test`: `vitest run`
- dependencies, all `catalog:` except the workspace packages: `effect`,
  `@effect/platform-node`, `@unhalteproblem.de/api` (`workspace:*`)
- devDependencies: `@unhalteproblem.de/tsconfig` (`workspace:*`),
  `typescript`, `tsx`, `@types/node`, `vitest`, `@effect/vitest`,
  `@effect/language-service`

Rules for the code:

- Copy wiring from the vendored examples above, adapted to package imports.
  Never import from `repos/`.
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

Run `pnpm --filter @unhalteproblem.de/<name> check-types`, then `test`, then
`build`. After that, start `dev` briefly and `curl` the health endpoint. Then
ask the `effect-reviewer` agent to review the new package and address its
findings. Report the created files and every command's result.
