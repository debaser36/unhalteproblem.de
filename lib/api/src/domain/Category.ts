import { noNul, slugString } from "#domain/Text";
import { Schema } from "effect";

/** Length and count limits of categories. */
export const CategoryLimits = {
  nameMaxLength: 48,
  slugMaxLength: 48,
  /** Most extra categories on one blog or post (besides the main one). */
  maxExtra: 3,
} as const;

/**
 * The categories seeded by a migration, by name. Not part of the API
 * surface: the list is exported for documentation and tests. Categories
 * can be added (implicitly by editors), renamed, merged and deleted.
 */
export const PresetCategories = [
  "Programming",
  "Web Development",
  "Systems & Infrastructure",
  "Security",
  "Data & AI",
  "Tools & Workflow",
  "Open Source",
  "Career",
  "Personal",
  "Miscellaneous",
] as const;

/**
 * Slug of the category of existing content and of newly approved
 * subblogs: `Miscellaneous`.
 */
export const DefaultCategorySlug = "miscellaneous";

/**
 * The slug a category name maps to; deterministic and pure, shared by the
 * backend and the web. NFKD-normalizes, strips combining marks, lowercases,
 * turns `&` into ` and `, replaces every run of characters other than
 * `a-z0-9` by one `-`, trims hyphens, cuts to 48 characters and trims a
 * trailing hyphen again. The result is empty when the name has no letter or
 * digit.
 *
 * `"Systems & Infrastructure"` gives `systems-and-infrastructure`, `"Café"`
 * gives `cafe`, `"!!!"` gives `""`.
 */
export const categorySlugOf = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, CategoryLimits.slugMaxLength)
    .replace(/-+$/u, "");

/** The slug of a category, e.g. `web-development`: 1 to 48 characters. */
export const CategorySlug = slugString(
  CategoryLimits.slugMaxLength,
  "web-development",
).annotate({
  identifier: "CategorySlug",
  description:
    "URL slug of a category, e.g. `web-development`: 1 to 48 lowercase " +
    "ASCII letters and digits in groups separated by single hyphens.",
});
export type CategorySlug = typeof CategorySlug.Type;

/**
 * The name of a category: trimmed, 1 to 48 characters, with at least one
 * ASCII letter or digit after normalization (so that it has a slug, see
 * `categorySlugOf`).
 */
export const CategoryName = Schema.Trimmed.check(
  noNul,
  Schema.isNonEmpty(),
  Schema.isMaxLength(CategoryLimits.nameMaxLength),
  Schema.makeFilter<string>(
    (name) => categorySlugOf(name) !== "" || "a name that has a slug",
    {
      expected:
        "a name with at least one letter or digit, from which a slug can " +
        "be derived",
    },
  ),
).annotate({
  identifier: "CategoryName",
  description:
    "The name of a category: trimmed, 1 to 48 characters, with at least " +
    "one letter or digit. Names are matched by their derived slug, so " +
    "`Web Development` and `web-development` are the same category.",
});
export type CategoryName = typeof CategoryName.Type;

/** A category as a reference: its slug and name. */
export const CategoryRef = Schema.Struct({
  slug: CategorySlug,
  name: CategoryName,
}).annotate({
  identifier: "CategoryRef",
  description: "A category: its slug and its name.",
});
export type CategoryRef = typeof CategoryRef.Type;

/** The categories of a blog or post: one main and up to three extra. */
export const Categories = Schema.Struct({
  main: CategoryRef,
  extra: Schema.Array(CategoryRef).check(
    Schema.isMaxLength(CategoryLimits.maxExtra),
  ),
}).annotate({
  identifier: "Categories",
  description:
    "The categories of a blog or post: exactly one main category and at " +
    "most three extra ones, without duplicates.",
});
export type Categories = typeof Categories.Type;

/**
 * The categories to set on a blog or post, by name. Each name is matched to
 * an existing category by its derived slug (`categorySlugOf`); a name that
 * matches none creates a new category, visible to everyone at once.
 */
export const CategoriesInput = Schema.Struct({
  main: CategoryName,
  extra: Schema.Array(CategoryName).check(
    Schema.isMaxLength(CategoryLimits.maxExtra),
  ),
})
  .check(
    Schema.makeFilter<{
      readonly main: string;
      readonly extra: ReadonlyArray<string>;
    }>(
      ({ main, extra }) => {
        const slugs = [main, ...extra].map(categorySlugOf);
        return (
          new Set(slugs).size === slugs.length ||
          "categories whose slugs are pairwise distinct"
        );
      },
      { expected: "a main and extra categories with pairwise distinct slugs" },
    ),
  )
  .annotate({
    identifier: "CategoriesInput",
    description:
      "One main category and at most three extra ones, by name. The slugs " +
      "derived from the names must be pairwise distinct (the main category " +
      "is not among the extra ones). Unknown names create new categories.",
  });
export type CategoriesInput = typeof CategoriesInput.Type;

/** A category in the public listing, with its usage. */
export const Category = Schema.Struct({
  slug: CategorySlug,
  name: CategoryName,
  /** Blogs having the category as main or extra. */
  blogCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** Published posts having the category as main or extra. */
  postCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({
  identifier: "Category",
  description:
    "A category with the number of blogs and of published posts that have " +
    "it, as main or extra category.",
});
export type Category = typeof Category.Type;

/** Payload of `PATCH /admin/categories/:category`. */
export const RenameCategoryPayload = Schema.Struct({
  name: CategoryName,
}).annotate({
  identifier: "RenameCategoryPayload",
  description:
    "The new name; the category's slug becomes the slug derived from it.",
});
export type RenameCategoryPayload = typeof RenameCategoryPayload.Type;

/** Payload of `POST /admin/categories/:category/merge`. */
export const MergeCategoryPayload = Schema.Struct({
  into: CategorySlug,
}).annotate({
  identifier: "MergeCategoryPayload",
  description: "The slug of the category that takes over the source's uses.",
});
export type MergeCategoryPayload = typeof MergeCategoryPayload.Type;
