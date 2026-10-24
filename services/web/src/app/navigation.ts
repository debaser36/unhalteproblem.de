/** The site's main sections, in header and footer order. */
export const sections = [
  { to: "/blog", label: "blog" },
  { to: "/projects", label: "projects" },
  { to: "/about", label: "about" },
  { to: "/contact", label: "contact" },
] as const;

/** The legal pages German law asks for, linked from the footer. */
export const legalPages = [
  { to: "/impressum", label: "impressum" },
  { to: "/datenschutz", label: "datenschutz" },
] as const;
