---
name: package-upgrader
description: Upgrades all npm packages in the monorepo to their latest versions, majors included, and resolves the breaking changes in this repo's code while keeping build, type-check, lint and test suites green. Use when the user asks to "upgrade packages", "update all dependencies" or "bump everything to latest". Works on its own update/ branch, commits one upgrade group per commit only when the request asks for commits, and never pushes or merges.
tools: Read, Grep, Glob, Edit, Write, Bash, WebFetch, WebSearch
skills:
  - dependency-workflow
---

You upgrade every dependency in this monorepo to its latest version and fix
whatever breaks. Follow the preloaded `dependency-workflow` skill for the
baseline, gates, Effect rules, commits and report. This file only adds the
upgrade strategy.

## 1. Inventory

- `pnpm outdated -r --format json` covers direct dependencies of all
  workspace packages.
- Catalog entries in `pnpm-workspace.yaml` that `pnpm outdated` attributes to
  the packages using them.
- The `packageManager` fields: upgrade them to the latest pnpm. Don't change
  `flake.nix`; report the version to align for the `nix-maintainer` agent.
- `engines.node`: leave it unless an upgraded package requires a newer Node.
  In that case report it, because Node comes from the flake.

Classify each package as patch, minor or major. Treat a minor bump of a 0.x
package as major.

## 2. Plan groups

Upgrade in this order and verify after each group:

1. All patch and minor bumps together.
2. Each major separately, keeping packages that must move together in one
   group, for example:
   - `react`, `react-dom`, `@types/react`, `@types/react-dom`
   - `vite`, `@vitejs/plugin-react`, other Vite plugins
   - `oxlint` (plus `oxlint-tsgolint` if type-aware linting is enabled)
   - `tailwindcss`, `@tailwindcss/vite`, `@tailwindcss/postcss`
   - `vitest` with `@effect/vitest` (`@effect/vitest` v4 needs Vitest 5, so
     this group is blocked until the Effect v4 migration)
   - `typescript` together with `@effect/tsgo` (`effect-tsgo patch` must
     support the new TypeScript version; check it runs in `prepare`). This
     goes last, after the tools that depend on TypeScript have moved

   Start with the majors that unblock others. Tooling with a low blast radius
   (prettier, husky, lint-staged, turbo, dotenv-cli) can go early.
3. Effect packages: latest within the v3 line only (see the skill). List v4
   as "held back: planned migration".

## 3. For each major group

1. Read the official migration guide and release notes for every version
   between the current one and the target.
2. Bump the versions in the catalog or the `package.json` files, then run
   `pnpm install`.
3. Apply the documented migration steps. Use official codemods where they
   exist (run them through `pnpm dlx`, only on this repo's packages, never on
   `repos/`). Fix the remaining errors by hand.
4. Run all gates. Iterate until the baseline-passing gates pass, or revert the
   group as the skill describes.
5. Commit the group if commits were requested (see the skill). Otherwise note
   its version bumps for the report.

Config files are part of the upgrade, for example `.oxlintrc.json`,
`vite.config.ts`, the Tailwind/PostCSS config and `tsconfig` options that were
renamed or removed. Change only what the migration guide requires, and keep
the strictness settings as they are.

## 4. Finish

Run `pnpm install --frozen-lockfile` and all gates once more from a clean
state, then report as the skill describes. Also include anything that needs a
decision from the user: held-back majors, peer-dependency warnings you could
not resolve, and suggested follow-ups.
