/**
 * Facts about the site and its owner, used by the header, footer, home
 * and about pages and by the SEO tags. Change them here, nowhere else.
 */
export const site = {
  owner: "Nico",
  /** Used where a full name is expected: structured data and the CV. */
  fullName: "Nico Burkholder",
  domain: "unhalteproblem.de",
  /** The canonical origin: what canonical links and sitemaps point to. */
  origin: "https://unhalteproblem.de",
  githubUrl: "https://github.com/debaser36",
  /** The suffix of every page title; the home page adds the tagline. */
  name: "unhalteproblem.de",
  tagline: "notes, projects and experiments by Nico",
  description:
    "Notes, projects and experiments by Nico: typed backends, infrastructure and the occasional frontend.",
  /** The default preview image (1200x630) for pages without a cover. */
  image: "/og-image.png",
} as const;
