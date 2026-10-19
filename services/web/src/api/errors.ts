import { Cause, Exit } from "effect";

/** The error tag a failed request ended with, if it was a declared API error. */
export const errorTag = (cause: Cause.Cause<unknown>): string | undefined => {
  const error = Cause.squash(cause);
  return typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string"
    ? error._tag
    : undefined;
};

const generic: Record<string, string> = {
  Unauthorized: "Your session has ended. Please log in again.",
  Forbidden: "You are not allowed to do that.",
  RateLimited: "Too many requests. Please wait a while and try again.",
  ServiceUnavailable: "The service is unavailable right now.",
};

/**
 * A message for the user about why a request failed. `messages` overrides
 * or adds texts per error tag; unknown failures (network down, a bug) get a
 * generic text.
 */
export const describeFailure = (
  cause: Cause.Cause<unknown>,
  messages: Record<string, string> = {},
): string => {
  const tag = errorTag(cause);
  if (tag !== undefined) {
    const message = messages[tag] ?? generic[tag];
    if (message !== undefined) return message;
  }
  return "Something went wrong. Check your connection and try again.";
};

/** `describeFailure` of a failed exit, `undefined` for a successful one. */
export const failureMessage = (
  exit: Exit.Exit<unknown, unknown>,
  messages?: Record<string, string>,
): string | undefined =>
  Exit.isFailure(exit) ? describeFailure(exit.cause, messages) : undefined;
