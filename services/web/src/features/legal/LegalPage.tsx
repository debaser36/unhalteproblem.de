import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { Seo } from "#app/Seo.tsx";
import { cn } from "#lib/cn.ts";
import { Container } from "#ui/Container.tsx";
import { PageHeader } from "#ui/PageHeader.tsx";
import { type Language, parseLanguage } from "./legal.ts";

export interface LegalText {
  readonly title: string;
  readonly description: string;
  readonly body: ReactNode;
}

const languages: ReadonlyArray<{
  readonly language: Language;
  readonly label: string;
  readonly name: string;
}> = [
  { language: "de", label: "DE", name: "Deutsch" },
  { language: "en", label: "EN", name: "English" },
];

const bindingNote: Record<Language, string> = {
  de: "Diese Seite gibt es auch auf Englisch; maßgeblich ist die deutsche Fassung.",
  en: "This is a translation for convenience; the German version is the binding one.",
};

/**
 * A legal page in German and English. The language is part of the URL
 * (`?lang=en`, German without it), so each version can be linked.
 */
export function LegalPage({
  path,
  text,
}: {
  /** The page's path, e.g. `/impressum`. */
  readonly path: string;
  readonly text: Record<Language, LegalText>;
}) {
  const [params] = useSearchParams();
  const language = parseLanguage(params.get("lang"));
  const { title, description, body } = text[language];

  return (
    <Container width="prose">
      {/* Both versions name the German one as canonical: it is the binding text. */}
      <Seo title={title} description={description} path={path} />
      <PageHeader
        path={`~${path}`}
        title={<span lang={language}>{title}</span>}
        actions={
          <nav aria-label="Language" className="flex gap-1 font-mono text-sm">
            {languages.map((entry) => (
              <Link
                key={entry.language}
                to={entry.language === "de" ? path : `${path}?lang=en`}
                replace
                hrefLang={entry.language}
                lang={entry.language}
                title={entry.name}
                aria-current={entry.language === language ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-colors",
                  entry.language === language
                    ? "bg-accent text-accent-fg"
                    : "text-fg-soft hover:bg-surface-2 hover:text-fg",
                )}
              >
                {entry.label}
              </Link>
            ))}
          </nav>
        }
      >
        <p lang={language} className="text-base">
          {bindingNote[language]}
        </p>
      </PageHeader>
      <article lang={language} className="doc animate-fade-up pb-16">
        {body}
      </article>
    </Container>
  );
}

/** A fact that is still missing; see `legal.ts`. */
export function Missing({ children }: { readonly children: ReactNode }) {
  return (
    <span className="rounded bg-danger-soft px-1 font-mono text-sm text-danger">
      [{children}]
    </span>
  );
}

/** The value, or a visible placeholder while it is `undefined`. */
export function Fact({
  value,
  missing,
}: {
  readonly value: string | undefined;
  readonly missing: string;
}) {
  return value === undefined ? <Missing>{missing}</Missing> : <>{value}</>;
}

/** A postal address, one line per entry. */
export function Address({
  lines,
  missing,
}: {
  readonly lines: ReadonlyArray<string> | undefined;
  readonly missing: string;
}) {
  if (lines === undefined) return <Missing>{missing}</Missing>;
  return lines.map((line, index) => (
    <span key={index}>
      {index > 0 && <br />}
      {line}
    </span>
  ));
}
