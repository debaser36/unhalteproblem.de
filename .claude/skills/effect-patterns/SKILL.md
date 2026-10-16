---
name: effect-patterns
description: Write or refresh a project-local Effect pattern reference at agent-patterns/effect-<topic>.md, derived from the vendored Effect source. Use when the user asks for a pattern file, or after /effect-update reports that one is stale.
argument-hint: "<topic, e.g. schema | services-layers | errors | http-api | sql-pg | testing | config | streams>"
---

Write `agent-patterns/effect-$ARGUMENTS.md`: a short, reusable reference so
agents don't have to rediscover the same patterns in every session.

## Research

Delegate the source survey to the `effect-researcher` agent. Ask for the
topic's core constructors and combinators, typical usage and the things to
avoid, each with `file:line` sources from:

- `repos/effect/LLMS.md` and `repos/effect/ai-docs/src/**`
- the module source and JSDoc examples in `repos/effect/packages/*/src`
- the tests in `repos/effect/packages/*/test`
- `repos/effect/migration/v3-to-v4.md`, for what changed from v3

## File format

```markdown
# Effect pattern: <Topic>

> Derived from repos/effect at effect@<version> (subtree <short sha>), <YYYY-MM-DD>.
> Re-generate with `/effect-patterns <topic>` after `/effect-update`.

## Imports

## Core constructors and combinators

## Common patterns (small examples, each with a "Source:" line)

## Error handling

## Testing

## v3 → v4 differences (old spelling → new spelling)

## Avoid
```

Rules:

- Keep the file under about 200 lines. It is a cheat sheet, not documentation,
  and it does not need to be exhaustive.
- Copy or adapt every example from real vendored code or docs, and cite its
  source path. Do not write examples from memory.
- Write the examples the way this repo uses them: package imports (`effect`,
  `effect/http`, …), never `repos/` paths. Mark any `@stability unstable` or
  `experimental` APIs.
- When refreshing an existing file, keep any hand-written notes in a
  `## Project notes` section and update the header line.
