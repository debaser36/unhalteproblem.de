# unhalteproblem.de

Personal website monorepo: pnpm workspaces + Turborepo, a Vite/React frontend in
`services/web`, and a planned backend. New code — especially backend and shared
libraries — is written in [Effect](https://effect.website).

## Layout

- `services/*` — deployable services (`services/web` is the frontend).
- `lib/*` — shared libraries and configs (`lib/tsconfig` holds the base tsconfig).
- `apps/*`, `packages/*`, `docs/*` — reserved workspace globs, currently empty.
- `repos/*` — vendored upstream repositories (git subtrees). See below.
- `agent-patterns/` — project-local Effect pattern notes written by agents with `/effect-patterns` (created on first use). Read the relevant file before writing Effect code on that topic.

## Commands

Run from the repo root; everything goes through Turborepo with `.env` loaded.

- `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm check-types`
- Scope to one package with `pnpm --filter <package-name> <script>`.
- Dev environment: `nix develop` (Node and pnpm come from `flake.nix`; they are not on the PATH outside it).

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

**Commits — only when the user asks for them.** Then use Conventional
Commit-style messages: a type, a colon, and a short lowercase imperative
summary:

| Type        | For                                                                     |
| ----------- | ----------------------------------------------------------------------- |
| `feat:`     | new functionality                                                       |
| `fix:`      | bug fixes                                                               |
| `refactor:` | code changes with no behaviour change                                   |
| `update:`   | dependency, flake or subtree version bumps                              |
| `test:`     | tests only                                                              |
| `docs:`     | documentation only (README, CLAUDE.md, agent-patterns)                  |
| `build:`    | build tooling and config (turbo, tsconfig, nix, vite, oxlint, prettier) |
| `chore:`    | everything else (repo housekeeping, Claude Code config)                 |

Keep commits modular: one feature, change or fix per commit. Stage only the
files that belong to that change (`git add <paths>`; interactive `git add -p`
is not available). Split the work into several commits rather than bundling
it. Where practical, every commit should leave build, type-check and tests
passing.

**Merging.** When a task is finished and verified, say so and ask whether to
merge. On yes: rebase the branch onto `main` if `main` has moved, run
`git switch main && git merge --ff-only <branch>`, and delete the branch.
Never push and never open PRs unless asked.

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
- Before writing Effect code, read `repos/effect/LLMS.md` and follow the
  `effect-development` skill. For anything non-trivial, ask the
  `effect-researcher` agent instead of reading the subtree in the main context.
- Most training data is Effect v3. When unsure whether an API is v3 or v4, check
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
  domain for a new one; see the backend README, section "Domains".
- Database schema changes go through the `db-migration` agent. Committed
  migrations are immutable.
- Authorization is role-based and lives in the types: code that needs a role
  requires `Authorized(...)` from `@unhalteproblem.de/api` (one call with
  several roles = any of them; several calls = all of them). Only
  `#auth/Authorization` in the backend provides these proofs, and endpoints
  use `RequireRoles(...)` from the contract. See the backend README, section
  "Authorization".

## Security

Changes touching authentication, authorization, sessions, cookies, tokens or
secrets need two checks before they count as done: a review by the
`effect-reviewer` agent (its auth checklist) and `/security-review`.

## Hooks

`.claude/settings.json` runs a type-check when Claude finishes a turn
(`.claude/hooks/typecheck.sh`). It runs `tsc` on every workspace package with
TypeScript files edited that turn, plus Effect language service diagnostics (`effect-tsgo`) on
edited files that import Effect. Errors are fed back once for fixing. Fix them;
don't silence them. Edits in other git worktrees of this repository are checked
with that worktree's `node_modules`; a worktree without them is skipped with a
note, so run `pnpm install` there first.

## Agents and skills

Agents (`.claude/agents/`):

- `effect-researcher`: read-only lookup of idiomatic v4 usage in `repos/effect`, returning patterns with `file:line` sources.
- `effect-reviewer`: reviews a diff for Effect idioms, v3 drift, boundary mistakes and auth/security. Read-only.
- `effect-test-writer`: writes and runs `@effect/vitest` tests.
- `api-contract`: owns `lib/api`; adds or changes endpoints and classifies changes as breaking or compatible.
- `db-migration`: writes and tests Postgres migrations, keeps Models in sync, and guards destructive changes.
- `package-upgrader`: upgrades all packages to latest (majors included) and fixes breaking changes while keeping the gates green.
- `dependency-maintainer`: dependency hygiene (patch/minor updates, `pnpm audit` fixes, catalog consistency, reports on available majors). Run only when the user asks; it is deliberately not scheduled.
- `nix-maintainer`: `flake.nix`/`flake.lock`, dev shell versions, `nix build`.

Skills (`.claude/skills/`):

- `effect-development`: method for grounding Effect code in local docs (adapted from Effect's own agent skill).
- `dependency-workflow`: shared baseline, gates and rules for dependency changes (preloaded by the dependency agents).
- `/effect-update`: pulls the latest Effect subtree and reports what changed.
- `/effect-patterns <topic>`: writes or refreshes `agent-patterns/effect-<topic>.md`.
- `/effect-service <name>`: scaffolds a new Effect backend service.
