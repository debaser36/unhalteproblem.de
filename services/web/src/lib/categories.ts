import {
  type CategoriesInput,
  CategoryLimits,
  categorySlugOf,
} from "@unhalteproblem.de/api";

/** Collapses runs of whitespace and trims, as category names are stored. */
export const cleanCategoryName = (name: string): string =>
  name.replace(/\s+/g, " ").trim();

/**
 * The categories an editor chose, checked by the rules of
 * `CategoriesInput`, or what is wrong with them. Extras that name the main
 * category or each other again (by slug, so "Web dev" and "web-dev" are
 * one) are dropped instead of refused.
 */
export const categoriesInput = (
  main: string,
  extra: ReadonlyArray<string>,
): CategoriesInput | string => {
  const mainName = cleanCategoryName(main);
  if (mainName === "") return "Choose a main category.";
  const problem = nameProblem(mainName);
  if (problem !== undefined) return problem;
  const seen = new Set([categorySlugOf(mainName)]);
  const extras: Array<string> = [];
  for (const raw of extra) {
    const name = cleanCategoryName(raw);
    if (name === "") continue;
    const nameError = nameProblem(name);
    if (nameError !== undefined) return nameError;
    const slug = categorySlugOf(name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    extras.push(name);
  }
  if (extras.length > CategoryLimits.maxExtra) {
    return `At most ${CategoryLimits.maxExtra} more categories.`;
  }
  return { main: mainName, extra: extras };
};

const nameProblem = (name: string): string | undefined => {
  if (name.length > CategoryLimits.nameMaxLength) {
    return `Category names have at most ${CategoryLimits.nameMaxLength} characters.`;
  }
  if (categorySlugOf(name) === "") {
    return `“${name}” needs at least one letter or digit.`;
  }
  return undefined;
};
