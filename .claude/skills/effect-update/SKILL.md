---
name: effect-update
description: Pull the latest upstream Effect source into the repos/effect git subtree and report what changed. Use only when the user asks to update the vendored Effect repository.
disable-model-invocation: true
argument-hint: "[ref, default: main]"
---

Update the vendored Effect subtree at `repos/effect` and report the changes.
The ref to pull is `$ARGUMENTS`; use `main` if it is empty.

1. **Preflight.** Run `git status --porcelain`. If the tree is not clean, stop
   and tell the user, because `git subtree pull` needs a clean tree. Create a
   branch from `main`: `git switch -c update/effect-subtree-<YYYY-MM-DD> main`.
   Record the current version from
   `repos/effect/packages/effect/package.json` and the current `HEAD` commit.
2. **Pull.** Running this skill counts as the request to commit, because
   `git subtree` always creates its own squash and merge commits.
   ```sh
   git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git <ref> --squash \
     -m "update: effect subtree to <ref>"
   ```
   Once the new version is known, reword that merge commit to
   `update: effect subtree to v<new version>` with
   `git commit --amend -m "…"`. Leave the squash commit itself untouched.
   If the merge conflicts, run `git merge --abort` and report the conflicting
   paths. Never resolve conflicts by hand-editing files under `repos/`. A
   conflict means something modified the vendored copy, and that needs to be
   found first.
3. **Report what changed.** Diff from the recorded `HEAD`:
   - The old and new `effect` version.
   - New entries in `repos/effect/packages/effect/CHANGELOG.md`, and in the
     CHANGELOGs of packages this repo uses or plans to use (`platform-node`,
     `sql-pg`, `vitest`, `opentelemetry`). Group them into breaking changes,
     new APIs and fixes.
   - Whether `repos/effect/LLMS.md`, `repos/effect/MIGRATION.md` or
     `repos/effect/migration/v3-to-v4.md` changed, with a summary of what
     changed.
4. **Check the catalog.** Compare the new version with the Effect entries in
   `pnpm-workspace.yaml` and list each mismatch. Do not change the catalog
   unless the user asks. The project is still on v3 by choice, and the
   migration to v4 is planned separately.
5. **Check the pattern files.** If `agent-patterns/` exists, list each pattern
   file whose APIs appear in the changelog entries, and suggest refreshing it
   with `/effect-patterns <topic>`.
6. **Check this repo's own code.** Search for uses of any API the changelog marks
   as removed or renamed, in this repository's code only (exclude `repos/` and
   `node_modules/`). List the hits; do not fix them.

Don't put any other changes into the subtree commits. Follow-ups (a catalog
bump, refreshed pattern files) are separate tasks with their own branches and
commits. Finish by asking whether to merge the branch into `main`.
