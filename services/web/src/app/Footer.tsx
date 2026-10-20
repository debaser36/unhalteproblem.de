import { Link } from "react-router";
import { Container } from "#ui/Container.tsx";
import { GithubIcon } from "#ui/GithubIcon.tsx";
import { site } from "./site.ts";
import { sections } from "./navigation.ts";

// The year the page was loaded in; the footer needs no live clock.
const year = new Date().getFullYear();

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface/50">
      <Container
        width="wide"
        className="flex flex-col gap-6 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="font-mono">
          <span className="text-accent">exit 0</span> · © {year} {site.owner} ·{" "}
          {site.domain}
        </p>
        <nav
          aria-label="Footer"
          className="flex flex-wrap gap-x-5 gap-y-2 font-mono"
        >
          {sections.map((section) => (
            <Link key={section.to} to={section.to} className="hover:text-fg">
              {section.label}
            </Link>
          ))}
          <a
            href={site.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-fg"
          >
            <GithubIcon size={14} /> github
          </a>
        </nav>
      </Container>
    </footer>
  );
}
