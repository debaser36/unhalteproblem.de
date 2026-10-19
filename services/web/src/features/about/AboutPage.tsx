import { ArrowRight } from "lucide-react";
import { site } from "#app/site.ts";
import { Badge } from "#ui/Badge.tsx";
import { ButtonLink, ExternalButtonLink } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { Container } from "#ui/Container.tsx";
import { GithubIcon } from "#ui/GithubIcon.tsx";
import { PageHeader } from "#ui/PageHeader.tsx";
import { experience, expertise, intro } from "./profile.ts";

export function AboutPage() {
  return (
    <Container>
      <PageHeader path="~/about" title="whoami">
        {intro[0]}
      </PageHeader>

      <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
        <div className="animate-fade-up space-y-12">
          <section className="space-y-4 text-lg text-fg-soft">
            {intro.slice(1).map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>

          <section aria-labelledby="experience" className="space-y-6">
            <h2 id="experience" className="text-2xl font-semibold text-fg">
              <span className="font-mono text-accent">01.</span> Experience
            </h2>
            <ol className="relative space-y-8 border-l border-border-strong pl-6">
              {experience.map((entry) => (
                <li key={`${entry.period}-${entry.role}`} className="relative">
                  <span className="absolute top-1.5 -left-[29px] h-2.5 w-2.5 rounded-full border-2 border-accent bg-bg" />
                  <p className="font-mono text-xs text-muted">{entry.period}</p>
                  <h3 className="mt-1 text-lg font-semibold text-fg">
                    {entry.role}{" "}
                    <span className="font-normal text-accent-2">
                      @ {entry.place}
                    </span>
                  </h3>
                  <p className="mt-1 text-fg-soft">{entry.summary}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="animate-fade-up space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-fg">
              <span className="font-mono text-accent">02.</span> Expertise
            </h2>
            <dl className="mt-5 space-y-4">
              {expertise.map((skill) => (
                <div key={skill.area}>
                  <dt className="font-mono text-xs tracking-wide text-muted uppercase">
                    {skill.area}
                  </dt>
                  <dd className="mt-2 flex flex-wrap gap-1.5">
                    {skill.items.map((item) => (
                      <Badge key={item}>{item}</Badge>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
          <div className="flex flex-wrap gap-2">
            <ButtonLink
              to="/contact"
              variant="primary"
              icon={<ArrowRight size={15} />}
            >
              Contact me
            </ButtonLink>
            <ExternalButtonLink href={site.githubUrl} icon={<GithubIcon />}>
              GitHub
            </ExternalButtonLink>
          </div>
        </aside>
      </div>
    </Container>
  );
}
