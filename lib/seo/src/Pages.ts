/** A page whose metadata does not depend on stored content. */
export interface StaticPage {
  readonly path: string;
  /** Without the site name; `undefined` for the home page. */
  readonly title?: string;
  /** `undefined` means the site's description. */
  readonly description?: string;
}

/**
 * The metadata of the pages the website has regardless of its content. The
 * website sets it in the head, and the backend renders it for crawlers, so
 * both say the same.
 */
export const staticPages = {
  home: { path: "/" },
  about: {
    path: "/about",
    title: "About",
    description:
      "About Nico: a software engineer who builds typed backends, the infrastructure they run on and the occasional frontend, with Effect, TypeScript, PostgreSQL and NixOS.",
  },
  contact: {
    path: "/contact",
    title: "Contact",
    description:
      "Questions, ideas or a project you want to talk about: send Nico a message.",
  },
  blog: {
    path: "/blog",
    title: "Blog",
    description:
      "Notes on what Nico learns: programming, infrastructure, security and tools, sorted into subblogs.",
  },
  projects: {
    path: "/projects",
    title: "Projects",
    description:
      "Software projects by Nico: what they do, how they are built and where to find the source.",
  },
} as const satisfies Record<string, StaticPage>;

export type StaticPageName = keyof typeof staticPages;
