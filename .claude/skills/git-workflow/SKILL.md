---
name: git-workflow
description: This repo's commit message format, commit modularity and merge procedure. Use before creating a commit (only when the user asked for one) or before merging a finished branch into main.
---

## Commits

Only commit when the user asks. Use Conventional Commit-style messages: a type,
a colon, and a short lowercase imperative summary.

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

## Merging

When a task is finished and verified, say so and ask whether to merge. On yes:
rebase the branch onto `main` if `main` has moved, run
`git switch main && git merge --ff-only <branch>`, and delete the branch.
Never push and never open PRs unless asked.
