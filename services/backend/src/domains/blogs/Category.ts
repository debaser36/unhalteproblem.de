import {
  type CategoriesInput,
  CategoryName,
  CategorySlug,
  categorySlugOf,
} from "@unhalteproblem.de/api";
import { Schema } from "effect";
import { Model } from "effect/schema";
import { UserId } from "#domains/users/User";

/**
 * Categories of subblogs and posts: one list shared by both. Every subblog
 * and every post has one main category and up to three extra ones. Editors
 * introduce new categories simply by using a new name; admins rename,
 * merge and delete them. A category's slug is derived from its name
 * (`categorySlugOf`), so names that differ only in case, punctuation or
 * accents are the same category.
 */

export { CategorySlug };

/** Our id of a category; the API addresses categories by their slug. */
export const CategoryId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("CategoryId"),
);
export type CategoryId = typeof CategoryId.Type;

/** A category as stored. */
export class CategoryRow extends Model.Class<CategoryRow>("CategoryRow")({
  id: CategoryId,
  slug: CategorySlug,
  name: CategoryName,
  createdAt: Schema.DateTimeUtcFromDate.pipe(
    Model.FieldExcept(["update", "jsonUpdate"]),
  ),
  /** Who introduced it; none for the presets and deleted accounts. */
  createdBy: Schema.OptionFromNullOr(UserId).pipe(
    Model.FieldExcept(["update", "jsonUpdate"]),
  ),
}) {}

/** A category named by an editor: its derived slug and the name as given. */
export interface NamedCategory {
  readonly slug: CategorySlug;
  readonly name: CategoryName;
}

/** The categories a subblog or post is given, as found or created. */
export interface ChosenCategories {
  readonly main: CategoryId;
  readonly extra: ReadonlyArray<CategoryId>;
}

/**
 * The categories of an input, main first. `CategoriesInput` has checked
 * that every name derives a slug and that the slugs are distinct.
 */
export const namedCategories = (
  input: CategoriesInput,
): ReadonlyArray<NamedCategory> =>
  [input.main, ...input.extra].map((name) => ({
    slug: categorySlugOf(name),
    name,
  }));

// Errors: the contract's, so they map to their status codes as they are.
export {
  CategoryInUse,
  CategoryMergeIntoSelf,
  CategoryNameTaken,
  CategoryNotFound,
} from "@unhalteproblem.de/api";

/** Postgres' unique constraint on category slugs. */
export const categorySlugConstraint = "categories_slug_key";
