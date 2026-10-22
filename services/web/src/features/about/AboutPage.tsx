import { ArrowRight, Download } from "lucide-react";
import { site } from "#app/site.ts";
import { Badge } from "#ui/Badge.tsx";
import { ButtonLink, ExternalButtonLink } from "#ui/Button.tsx";
import { Card } from "#ui/Card.tsx";
import { Container } from "#ui/Container.tsx";
import { GithubIcon } from "#ui/GithubIcon.tsx";
import { PageHeader } from "#ui/PageHeader.tsx";
import {
  approach,
  cvPath,
  experience,
  expertise,
  interests,
  intro,
  now,
} from "./profile.ts";

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
            <ul className="grid gap-4 sm:grid-cols-2">
              {experience.map((entry) => (
                <li key={`${entry.period}-${entry.role}`}>
                  <Card className="h-full p-5">
                    <p className="font-mono text-xs text-muted">
                      {entry.period}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-fg">
                      {entry.role}
                    </h3>
                    <p className="text-accent-2">{entry.place}</p>
                    <p className="mt-3 text-fg-soft">{entry.summary}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="now" className="space-y-4">
            <h2 id="now" className="text-2xl font-semibold text-fg">
              <span className="font-mono text-accent">02.</span> Right now
            </h2>
            <p className="text-lg text-fg-soft">{now}</p>
          </section>

          <section aria-labelledby="approach" className="space-y-6">
            <h2 id="approach" className="text-2xl font-semibold text-fg">
              <span className="font-mono text-accent">03.</span> Approach
            </h2>
            <ol className="grid gap-4 sm:grid-cols-2">
              {approach.map((principle, index) => (
                <li key={principle.title}>
                  <Card className="h-full p-5">
                    <p className="font-mono text-xs text-accent">
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-fg">
                      {principle.title}
                    </h3>
                    <p className="mt-2 text-fg-soft">{principle.text}</p>
                  </Card>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="interests" className="space-y-4">
            <h2 id="interests" className="text-2xl font-semibold text-fg">
              <span className="font-mono text-accent">04.</span> Interests
            </h2>
            <div className="flex flex-wrap gap-2">
              {interests.map((interest) => (
                <Badge key={interest}>{interest}</Badge>
              ))}
            </div>
          </section>
        </div>

        <aside className="animate-fade-up space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-fg">
              <span className="font-mono text-accent">05.</span> Expertise
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
            <ExternalButtonLink href={cvPath} icon={<Download size={15} />}>
              CV (PDF)
            </ExternalButtonLink>
          </div>
        </aside>
      </div>
    </Container>
  );
}
