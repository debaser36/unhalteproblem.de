---
name: effect-development
description: Effect development guidance. Use when implementing or reviewing code that composes Effect APIs or patterns (Effect, Layer, Schema, Stream, http, sql, cli, testing).
---

<!--
Adapted from Effect's own agent skill:
repos/effect/.agents/skills/effect-development/SKILL.md (MIT, Effect-TS).
Paths are rewritten for the vendored subtree, and steps 4 and 5 are added for this repository.
-->

Use the vendored Effect documentation as targeted reference, not ambient
context:

1. Identify the Effect APIs and concepts involved in the change.
2. Check `agent-patterns/` and existing code in this repo first; if the pattern is there, stop. Otherwise grep (do not read whole) `repos/effect/LLMS.md` and `repos/effect/ai-docs/src` for those names
   and concepts, then read the matching sections and examples. If
   `agent-patterns/effect-<topic>.md` exists for the topic, read it first.
3. Apply the relevant guidance and inspect the module source
   (`repos/effect/packages/*/src`) and its tests
   (`repos/effect/packages/*/test`) for conventions not covered by the
   documentation.
4. For every API you are not certain exists in v4, confirm it in
   `repos/effect/migration/v3-to-v4.md` or the module source. Do not rely on
   memory of Effect v3.
5. Confirm the import path against the `exports` map of
   `repos/effect/packages/<package>/package.json`, and import from the package
   name, never from `repos/`.

The task is ready for implementation when every material Effect API or pattern
has matching local guidance, or the search has established that none exists.

If the lookup would need many files, delegate it to the `effect-researcher`
agent and continue with its summary.
