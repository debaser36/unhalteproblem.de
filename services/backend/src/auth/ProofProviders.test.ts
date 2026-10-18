import { assert, describe, it } from "@effect/vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("..", import.meta.url));

/**
 * The only files allowed to provide the services authorization trusts:
 * `Authorized` proofs are made after a role check, `CurrentUser` after a
 * session lookup. Tests may provide them freely.
 */
const allowed = new Set(["auth/Authorization.ts", "http/Authentication.ts"]);

/** A call that provides a service, and the start of its arguments. */
const providing =
  /\b(?:provideService(?:Effect)?|Layer\.(?:succeed|effect|sync|scoped)|Context\.(?:make|add))\s*\(([^;]{0,300})/g;
/** The services in question, as they appear in those arguments. */
const trusted = /\bAuthorized\s*\(|\.authorized\b|\bCurrentUser\b/;

const sourceFiles = (directory: string): Array<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "testing" ? [] : sourceFiles(path);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });

describe("authorization proofs", () => {
  it("are provided only by the authorization and authentication code", () => {
    const offenders = sourceFiles(src)
      .map((path) => relative(src, path))
      .filter((file) => !allowed.has(file))
      .filter((file) =>
        [...readFileSync(join(src, file), "utf8").matchAll(providing)].some(
          ([, args]) => trusted.test(args ?? ""),
        ),
      );
    assert.deepStrictEqual(offenders, []);
  });

  it("the check finds a hand-made proof", () => {
    const sample = `effect.pipe(Effect.provideService(Authorized("admin"), proof))`;
    assert.isTrue(
      [...sample.matchAll(providing)].some(([, args]) =>
        trusted.test(args ?? ""),
      ),
    );
  });
});
