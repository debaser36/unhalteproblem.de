/** Joins class names, skipping falsy ones: `cn("a", cond && "b")`. */
export const cn = (
  ...classes: ReadonlyArray<string | false | null | undefined>
): string => classes.filter(Boolean).join(" ");
