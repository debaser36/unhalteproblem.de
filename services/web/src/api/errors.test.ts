import { Forbidden, PostNotFound } from "@unhalteproblem.de/api";
import { Cause, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { describeFailure, errorTag, failureMessage } from "./errors.ts";

describe("errors", () => {
  it("reads the tag of a declared error", () => {
    expect(errorTag(Cause.fail(new PostNotFound({ post: "x" })))).toBe(
      "PostNotFound",
    );
    expect(errorTag(Cause.die(new Error("boom")))).toBeUndefined();
  });

  it("prefers the caller's message, then the generic one, then a fallback", () => {
    const notFound = Cause.fail(new PostNotFound({ post: "x" }));
    expect(describeFailure(notFound, { PostNotFound: "gone" })).toBe("gone");
    expect(describeFailure(Cause.fail(new Forbidden()))).toMatch(/not allowed/);
    expect(describeFailure(notFound)).toMatch(/Something went wrong/);
  });

  it("says nothing about a success", () => {
    expect(failureMessage(Exit.succeed(1))).toBeUndefined();
    expect(failureMessage(Exit.fail(new Forbidden()))).toMatch(/not allowed/);
  });
});
