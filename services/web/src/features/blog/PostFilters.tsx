import { useAtomValue } from "@effect/atom-react";
import { CategorySlug, PostSort } from "@unhalteproblem.de/api";
import { Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "#ui/Badge.tsx";
import { Select } from "#ui/Field.tsx";
import type { PostFilter } from "./blogAtoms.ts";
import { categoriesAtom } from "./blogAtoms.ts";
import { postSortLabels } from "./postFilter.ts";

const decodeSort = Schema.decodeUnknownOption(PostSort);
const decodeCategory = Schema.decodeUnknownOption(CategorySlug);

/**
 * The order and filters of a post list: sort and category as selects, the
 * tag and author (set by clicking them on a post) as removable chips.
 */
export function PostFilters({
  filter,
  onChange,
}: {
  readonly filter: PostFilter;
  readonly onChange: (change: Partial<PostFilter>) => void;
}) {
  const categories = useAtomValue(categoriesAtom);
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-muted">
        <span className="font-mono text-xs uppercase">Sort</span>
        <Select
          className="w-auto"
          value={filter.sort}
          onChange={(e) =>
            onChange({
              sort: Option.getOrElse(
                decodeSort(e.target.value),
                () => "newest",
              ),
            })
          }
        >
          {Object.entries(postSortLabels).map(([sort, label]) => (
            <option key={sort} value={sort}>
              {label}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex items-center gap-2 text-sm text-muted">
        <span className="font-mono text-xs uppercase">Category</span>
        <Select
          className="w-auto max-w-56"
          value={filter.category ?? ""}
          onChange={(e) =>
            onChange({
              category: Option.getOrUndefined(decodeCategory(e.target.value)),
            })
          }
        >
          <option value="">All categories</option>
          {AsyncResult.isSuccess(categories) &&
            categories.value
              // Unused ones (or the selected one) would only lead nowhere.
              .filter(
                (category) =>
                  category.postCount > 0 || category.slug === filter.category,
              )
              .map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name} ({category.postCount})
                </option>
              ))}
        </Select>
      </label>
      {filter.tag !== undefined && (
        <Chip
          label="Remove the tag filter"
          onClear={() => onChange({ tag: undefined })}
        >
          #{filter.tag}
        </Chip>
      )}
      {filter.author !== undefined && (
        <Chip
          label="Remove the author filter"
          onClear={() => onChange({ author: undefined })}
        >
          one author
        </Chip>
      )}
    </div>
  );
}

function Chip({
  children,
  label,
  onClear,
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly onClear: () => void;
}) {
  return (
    <Badge tone="accent">
      {children}
      <button
        type="button"
        aria-label={label}
        onClick={onClear}
        className="-mr-1 rounded hover:text-fg"
      >
        <X size={13} />
      </button>
    </Badge>
  );
}
