import { CategorySlug, PostSort, Tag, UserId } from "@unhalteproblem.de/api";
import { Option, Schema } from "effect";
import { useCallback } from "react";
import { useSearchParams } from "react-router";
import type { PostFilter } from "./blogAtoms.ts";

const decodeSort = Schema.decodeUnknownOption(PostSort);
const decodeTag = Schema.decodeUnknownOption(Tag);
const decodeCategory = Schema.decodeUnknownOption(CategorySlug);
const decodeAuthor = Schema.decodeUnknownOption(UserId);

/** The sort orders of post lists, as offered to readers. */
export const postSortLabels: Record<PostSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  updated: "Recently updated",
  title: "Title A–Z",
  readingTime: "Shortest read first",
  category: "By category",
  author: "By author",
};

const param = <A>(
  decode: (value: unknown) => Option.Option<A>,
  value: string | null,
): A | undefined => Option.getOrUndefined(decode(value ?? undefined));

/** The query string of a post filter, without the default sort. */
export const postFilterSearch = (filter: PostFilter): string => {
  const search = new URLSearchParams();
  if (filter.sort !== "newest") search.set("sort", filter.sort);
  if (filter.tag !== undefined) search.set("tag", filter.tag);
  if (filter.category !== undefined) search.set("category", filter.category);
  if (filter.author !== undefined) search.set("author", filter.author);
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
};

/**
 * The order and filters of a post list, kept in the URL (`?sort=title&
 * category=security&tag=rust&author=<id>`) so they can be linked and
 * survive a reload. Values that don't decode are ignored.
 */
export const usePostFilter = () => {
  const [search, setSearch] = useSearchParams();
  const filter: PostFilter = {
    sort: param(decodeSort, search.get("sort")) ?? "newest",
    tag: param(decodeTag, search.get("tag")),
    category: param(decodeCategory, search.get("category")),
    author: param(decodeAuthor, search.get("author")),
  };
  const update = useCallback(
    (change: Partial<PostFilter>) =>
      setSearch(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(change)) {
            if (value === undefined || (key === "sort" && value === "newest")) {
              next.delete(key);
            } else {
              next.set(key, String(value));
            }
          }
          return next;
        },
        { replace: true },
      ),
    [setSearch],
  );
  return [filter, update] as const;
};

/** A key that changes with the filter, to restart a list's paging. */
export const filterKey = (filter: PostFilter): string =>
  postFilterSearch(filter);
