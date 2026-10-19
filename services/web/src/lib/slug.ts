/**
 * A URL slug from a title: lowercase ASCII letters and digits in groups
 * separated by single hyphens (`"Über Effect & Nix!"` → `"uber-effect-nix"`),
 * at most `maxLength` characters. Matches the contract's slug rule.
 */
export const slugify = (title: string, maxLength = 128): string =>
  title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
