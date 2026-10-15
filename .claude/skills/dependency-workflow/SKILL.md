---
name: dependency-workflow
description: Shared procedure for changing npm dependencies in this pnpm/Turborepo monorepo safely, covering the baseline, quality gates, catalog handling and rules. Preloaded by the dependency-maintainer and package-upgrader agents; use directly whenever dependencies are added, bumped or removed.
user-invocable: false
---

# Dependency workflow

## Environment

- Node and pnpm come from `flake.nix`. If `node` is not on the PATH, prefix
  every command with `nix develop --option warn-dirty false -c`.
- Run all commands from the repository root.

## Where versions live

- `pnpm-workspace.yaml`, under `catalog:`, holds shared versions. Packages
  reference them as `"<name>": "catalog:"`. Edit catalog entries directly in
  the YAML, then run `pnpm install`.
- Each `package.json` (`services/*`, `lib/*`, the root) holds direct versions.
  A dependency used by more than one package should move to the catalog.
- The `packageManager` fields (root and `services/web`) should name the same
  pnpm version.
- Node and pnpm in `flake.nix` are owned by the `nix-maintainer` agent. Report
  mismatches there, don't fix them here.
- `repos/` is vendored and read-only. Its `package.json`/lockfiles are never
  touched, and its packages are never part of an upgrade.

## Effect packages

The catalog intentionally pins the Effect **v3** line (`effect@3`,
`@effect/*@0.x`) until a planned migration to v4. Upgrades stay within v3 and
its matching `@effect/*` 0.x versions, and `effect@4` is never adopted as part
of a routine upgrade. `@effect/language-service` is versioned separately and
may be upgraded normally. Adopt v4 only when the request explicitly asks for
the Effect v4 migration. Then all Effect packages move together to the exact
version in `repos/effect/packages/effect/package.json`.

## Baseline (before changing anything)

1. Check that `git status --porcelain` is clean. If it isn't, stop and report.
2. Create a branch from up-to-date `main`:
   `git switch -c update/<task>-<YYYY-MM-DD> main`.
3. Run `pnpm install --frozen-lockfile`.
4. Run each gate and record pass or fail, plus the failing output:
   - `pnpm build`
   - `pnpm check-types`
   - `pnpm lint`
   - `pnpm test`

   A gate that fails at baseline is pre-existing. Note it, don't try to fix it
   as part of the upgrade, and require that it doesn't get worse.

## Applying a change

- Get release notes from the package's CHANGELOG, GitHub releases or official
  migration guide before every major bump (WebFetch), and for any minor bump
  of a pre-1.0 package. Don't rely on memory.
- pnpm may enforce a minimum release age. If the newest version is too fresh,
  take the newest allowed one. Never add entries to `minimumReleaseAgeExclude`
  just to get a newer version.
- After each change, run `pnpm install`, then all gates.

## Rules for "not breaking the tests"

- A change is done only when every gate that passed at baseline still passes.
- Fix breaking changes in the code that uses the dependency. Never:
  - delete, skip (`.skip`, `.only`, `todo`) or weaken tests or assertions;
  - add `@ts-ignore`/`@ts-expect-error`/`as any`, or loosen `tsconfig` or lint
    rules to get green;
  - pin a transitive dependency via `overrides` without a written reason in
    the report.
- If a breaking change cannot be resolved cleanly within the group, revert
  that group (`git checkout -- <files>` plus `pnpm install`) and report it as
  held back, with the blocking error and the relevant release-note link.

## Commits

Follow the git workflow in `CLAUDE.md`. Commit only if the request asks for
commits. Then make one commit per passing group on the branch you created,
using the `update:` type (`update: vite 7 → 8`, `update: patch and minor
bumps`), so each group can be reverted on its own.

If the request does not ask for commits, leave all groups uncommitted on the
branch. List in the report which version bumps form which group, so they can
be committed afterwards.

Never push, never open a PR, and never merge into `main` yourself. Merging is
decided in the main conversation once the work is finished.

## Report

End with a table of each package's old version, new version, type
(patch/minor/major), status (upgraded/held back) and notes. Follow it with the
baseline and final gate results, any code changes made for breaking changes
(as `file:line`), and the follow-ups that are left.
