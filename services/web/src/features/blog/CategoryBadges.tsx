import type { Categories } from "@unhalteproblem.de/api";
import { Link } from "react-router";
import { cn } from "#lib/cn.ts";
import { Badge } from "#ui/Badge.tsx";

/**
 * The categories of a subblog or post: the main one highlighted, then the
 * extras. Each links to the posts with that category under `base`.
 */
export function CategoryBadges({
  categories,
  base = "/blog",
  className,
}: {
  readonly categories: Categories;
  /** The list a badge filters; the blog index by default. */
  readonly base?: string;
  readonly className?: string;
}) {
  return (
    <ul
      aria-label="Categories"
      className={cn("relative z-10 flex flex-wrap gap-1.5", className)}
    >
      {[categories.main, ...categories.extra].map((category, index) => (
        <li key={category.slug}>
          <Link to={`${base}?category=${category.slug}`}>
            <Badge
              tone={index === 0 ? "info" : "neutral"}
              className="hover:border-accent-2/60"
              title={index === 0 ? "Main category" : undefined}
            >
              {category.name}
            </Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
