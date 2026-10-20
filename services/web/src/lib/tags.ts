import { BlogLimits } from "@unhalteproblem.de/api";
import { slugify } from "./slug.ts";

/**
 * Tags from what an editor typed (`"Effect, nix  TS"`): slugs, unique, at
 * most 10 — the rules posts and projects share.
 */
export const parseTags = (text: string): ReadonlyArray<string> =>
  [
    ...new Set(
      text
        .split(/[,\s]+/)
        .map((tag) => slugify(tag, BlogLimits.tagMaxLength))
        .filter(Boolean),
    ),
  ].slice(0, BlogLimits.maxTags);
