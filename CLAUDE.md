# unhalteproblem.de

Personal website monorepo: pnpm workspaces + Turborepo, a Vite/React frontend in
`services/web`, and a planned backend. New code — especially backend and shared
libraries — is written in [Effect](https://effect.website).

## Layout

- `services/*` — deployable services (`services/web` is the frontend).
- `lib/*` — shared libraries and configs (`lib/tsconfig` holds the base tsconfig).
- `apps/*`, `packages/*`, `docs/*` — reserved workspace globs, currently empty.
- `repos/*` — vendored upstream repositories (git subtrees). See below.
- `agent-patterns/` — project-local Effect pattern notes written by agents with `/effect-patterns`. Read the relevant file before writing Effect code on that topic.

## Commands

Run from the repo root; everything goes through Turborepo with `.env` loaded.

- `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm check-types`
- Scope to one package with `pnpm --filter <package-name> <script>`.
- `pnpm test:e2e` runs the Playwright smoke tests in `services/web/e2e` against
  the local stack (starts it with `stack up`). Testing layers of the website:
  `services/web/README.md`.
- Dev environment: `nix develop` (Node and pnpm come from `flake.nix`; they are not on the PATH outside it).
- Trying a change in the real app: `stack up` in the dev shell starts Postgres, backend and website with a seeded admin (`stack help`, `/run-local`). Source: `nix/stack.sh`.
- Keep command output short; it stays in context for the rest of the session.
  Pass `--output-logs=errors-only` to turbo runs, use `--reporter=dot` for
  vitest, scope to the affected package with `--filter`, and pipe long
  output through `tail -n 50`. Re-run verbosely only to debug a failure.

## Imports and path aliases

- Inside a package, import across folders through aliases, never through
  relative paths like `../../domain/User`. Relative imports are only for files
  in the same folder.
- Aliases are Node subpath imports in the package's own `package.json`
  `"imports"` field, prefixed with `#` (`@` is reserved for npm scopes).
  Node, Vite, Vitest and TypeScript resolve them natively, so don't duplicate
  them as tsconfig `paths` or Vite `resolve.alias`.
- One alias per source folder, named exactly like the folder:
  `"#domain/*": "./src/domain/*.ts"` gives `import { User } from "#domain/User"`.
  No abbreviations and no catch-alls like `#src/*` or `#/*`.
- A file directly in `src/` that other folders import gets a single-file
  alias named exactly like the file: `"#Config": "./src/Config.ts"`.
- When you add a folder or module, add its alias in the same change.
- Across packages, import by workspace package name and its `exports`
  (`@unhalteproblem.de/api`), never from another package's `src/`. A `#…`
  alias always resolves against the importing file's own package.

## Git workflow

**Branches.** Do each task on its own branch, created from up-to-date `main`
before the first change: `<type>/<short-kebab-description>` (e.g.
`feat/api-contract`, `fix/flake-build`, `update/packages-2026-10-15`). Use one
branch per independent task. If you notice an unrelated problem along the
way, note it for its own branch instead of fixing it on the current one.

**Commits — only when the user asks for them**, and never push or open PRs
unless asked. Load the `git-workflow` skill before committing or merging: it
has the commit message types, the modular-commit rules and the merge steps.
When a task is finished and verified, say so and ask whether to merge.

## Vendored repositories (`repos/`)

`repos/` contains upstream source added with `git subtree --squash`. It exists so
agents can read real library source instead of guessing or searching the web.

- Treat everything under `repos/` as **read-only reference material**. Editing it
  is denied in `.claude/settings.json`; do not work around that with shell
  commands. Only the `/effect-update` skill changes it, via `git subtree pull`.
- **Never import from `repos/`.** Application code uses normal package
  dependencies from the pnpm catalog.
- Prefer patterns, examples and tests from vendored source over generated
  guesses, `node_modules` (compiled output) or web search results.
- `repos/` is excluded from Prettier, lint-staged and VS Code search/watchers.
  Do not run formatters, linters or codemods over it.
- `repos/effect/.agents/` holds the instructions and skills for people working on
  Effect itself (changesets, jsdocs, CI). They do not apply to this repository.

## Effect

- `repos/effect` is **Effect v4** (see `repos/effect/packages/effect/package.json`
  for the exact version). It is the source of truth for idiomatic Effect code.
- Before writing Effect code, follow the `effect-development` skill. Check
  existing code in this repo and `agent-patterns/` first; when the pattern is
  already there, use it without further research. Otherwise search
  `repos/effect/LLMS.md` for the relevant section (don't read all of it), and
  for anything non-trivial ask the `effect-researcher` agent instead of
  reading the subtree in the main context. A lookup you expect to need again
  belongs in `agent-patterns/` via `/effect-patterns`.
- Most training data is Effect v3. When unsure whether an API is v3 or v4, check
  `agent-patterns/effect-v3-to-v4.md` first, then
  `repos/effect/MIGRATION.md` and `repos/effect/migration/v3-to-v4.md` (import map
  plus a per-module API reference, e.g. search for ``### `effect/Effect` ``).
- In v4, `@effect/platform`, `@effect/cli`, `@effect/sql`, `@effect/rpc` and
  similar packages are merged into `effect` and imported as `effect/http`,
  `effect/cli`, `effect/sql`, etc. Check the `exports` map of
  `repos/effect/packages/effect/package.json` for valid import paths.
- **Versions:** the pnpm catalog (`pnpm-workspace.yaml`) pins `effect` and
  every `@effect/*` package except `@effect/tsgo` to the exact version of
  `repos/effect`, so the vendored source matches what is installed. They move
  together, and only after `/effect-update` has pulled the subtree; don't bump
  them unless asked. Reference them as `catalog:` from services. The v3-only
  packages (`@effect/platform`, `@effect/sql`, `@effect/cli`, `@effect/rpc`)
  are gone; never add them.
- Check an API's `@stability` JSDoc tag before relying on it. `unstable` APIs can
  break in minor releases, `experimental` ones in patch releases.

## Backend architecture

- The HTTP contract lives in `lib/api` (`@unhalteproblem.de/api`): `HttpApi`
  groups, endpoints, schemas and middleware _definitions_, depending only on
  `effect` and the browser-safe protocol schemas of `@unhalteproblem.de/oidc`.
  Services implement it, and `services/web` consumes it with
  `HttpApiClient`. Change it only through the `api-contract` agent, which
  checks for breaking changes.
- OpenID Connect lives in `lib/oidc` (`@unhalteproblem.de/oidc`): protocol
  schemas and the `OidcApi` of the Keycloak realm, called with
  `HttpApiClient`. Our own endpoints that take part in the protocol (login
  callback, back-channel logout) belong in `lib/api` and reuse its schemas.
- New services are scaffolded with `/effect-service <name>`, never by hand.
- Backend business logic lives in domains (`services/backend/src/domains/<domain>/`)
  on the kernel in `src/cqrs/`: state changes go through a `…Commands`
  service (`Command.boundary`, one transaction, events published after the
  commit), reads through `…Queries` (`Query.boundary`). Copy the `users`
  domain for a new one; see `services/backend/docs/domains.md`.
- Database schema changes go through the `db-migration` agent. Committed
  migrations are immutable.
- Authorization is role-based and lives in the types: code that needs a role
  requires `Authorized(...)` from `@unhalteproblem.de/api` (one call with
  several roles = any of them; several calls = all of them). Only
  `#auth/Authorization` in the backend provides these proofs, and endpoints
  use `RequireRoles(...)` from the contract. See
  `services/backend/docs/authorization.md`.

## Security

Changes touching authentication, authorization, sessions, cookies, tokens or
secrets need two checks before they count as done: a review by the
`effect-reviewer` agent (its auth checklist) and `/security-review`.
Run both once over the finished branch diff before asking to merge, not after
each step or commit.

## Token budget

- **Read narrowly.** Never read a whole large file when a section will do:
  `services/backend/README.md` is only an index (the topics are in
  `services/backend/docs/`), and `*.test.ts` files can be thousands of lines,
  so `Grep` for what you need and use `offset`/`limit`.
- **Search `repos/` with a narrow `path`** (for example
  `repos/effect/packages/effect/src/unstable/http`), with `head_limit` or
  `-m`. `repos/effect/migration/v3-to-v4.md` is 1.4 MB: search it for exact
  names only, and try `agent-patterns/effect-v3-to-v4.md` first. Dependency
  folders, `dist/` and `pnpm-lock.yaml` are denied for reading; use
  `pnpm why` / `pnpm outdated` instead.
- **Subagents start cold**, so use them where they add something the main
  session can't: one `effect-reviewer` pass per branch, the owning agent for
  `lib/api` and migrations, and `effect-researcher` only when the pattern
  isn't in this repo or `agent-patterns/` yet. Give each agent the file paths
  and facts you already have. Subagents cannot start subagents.
- **Models.** Routine edits and test writing do not need the strongest model;
  `effect-test-writer`, `api-contract` and `effect-researcher` run on Sonnet.
  Keep the strong model for design, auth and the reviews.
- Do one task per session; suggest a fresh session rather than continuing past
  a context compaction.

## Type-check hook

`.claude/hooks/typecheck.sh` runs when a turn ends: `tsc` for each edited
workspace package, Effect diagnostics for edited files importing Effect. Errors
come back once; fix them and don't silence them. A worktree without
`node_modules` is skipped, so run `pnpm install` there first.
