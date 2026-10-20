import { ArrowRight, FolderGit2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ButtonLink } from "#ui/Button.tsx";

const lines = [
  "while (!halts(program)) {",
  "  think();",
  "  write();",
  "  ship();",
  "}",
];

/**
 * The start page's hero: who this is, and a small terminal that types out
 * a loop nobody can prove terminates — the site's namesake, the halting
 * problem (German: Halteproblem).
 */
export function Hero() {
  const total = lines.join("\n").length;
  // Without motion, the whole loop is there at once.
  const [reduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [shown, setShown] = useState(reduced ? total : 0);

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(
      () => setShown((n) => (n >= total ? n : n + 1)),
      35,
    );
    return () => clearInterval(timer);
  }, [reduced, total]);

  const typed = lines.join("\n").slice(0, shown);

  return (
    <section className="grid items-center gap-12 pt-14 pb-16 sm:pt-24 lg:grid-cols-[1.1fr_1fr]">
      <div className="animate-fade-up space-y-7">
        <p className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 font-mono text-xs text-accent">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          status: running · halts: undecidable
        </p>
        <h1 className="text-5xl leading-[1.05] font-semibold text-fg sm:text-6xl">
          Notes, projects
          <br />
          and experiments
          <span className="text-accent">.</span>
        </h1>
        <p className="max-w-xl text-lg text-fg-soft">
          I'm Nico. I write about software, type systems, infrastructure and
          whatever I'm currently taking apart, and I keep a log of the things I
          build.
        </p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink
            to="/blog"
            variant="primary"
            icon={<ArrowRight size={16} />}
          >
            Read the blog
          </ButtonLink>
          <ButtonLink to="/projects" icon={<FolderGit2 size={16} />}>
            See projects
          </ButtonLink>
        </div>
      </div>

      <div className="animate-fade-up overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-glow [animation-delay:120ms]">
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
          <span className="h-3 w-3 rounded-full bg-danger/70" />
          <span className="h-3 w-3 rounded-full bg-warning/70" />
          <span className="h-3 w-3 rounded-full bg-accent/70" />
          <span className="ml-2 font-mono text-xs text-muted">~/life.ts</span>
        </div>
        <pre className="min-h-52 overflow-x-auto p-5 font-mono text-sm leading-7 text-fg-soft sm:text-base">
          <code>
            {typed}
            <span className="animate-blink text-accent">▍</span>
          </code>
        </pre>
      </div>
    </section>
  );
}
