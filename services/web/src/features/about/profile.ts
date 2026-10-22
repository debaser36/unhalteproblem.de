/**
 * The content of the about page. Plain data, so changing the text never
 * means touching markup.
 */

export const intro = [
  "Hi, I'm Nico. I build software end to end: typed backends, the infrastructure they run on, and the occasional frontend.",
  "This site is my playground for that: notes on what I learn, write-ups of my projects, and the place to reach me.",
];

export const cvPath = "/cv-nico-burkholder.pdf";

export interface Skill {
  readonly area: string;
  readonly items: ReadonlyArray<string>;
}

export const expertise: ReadonlyArray<Skill> = [
  {
    area: "Languages",
    items: ["TypeScript", "JavaScript", "C", "C++", "Python", "Haskell", "Nix"],
  },
  {
    area: "Backend",
    items: ["Effect", "Node.js", "PostgreSQL", "REST APIs", "OpenID Connect"],
  },
  {
    area: "DevOps",
    items: ["Docker", "Linux", "NixOS"],
  },
  {
    area: "Tools",
    items: ["Git", "LaTeX", "Isabelle"],
  },
  {
    area: "Spoken",
    items: ["German (native)", "English (business fluent)"],
  },
];

export interface Experience {
  readonly period: string;
  readonly role: string;
  readonly place: string;
  readonly summary: string;
}

export const experience: ReadonlyArray<Experience> = [
  {
    period: "Sep 2026 – now",
    role: "AI Data Annotation (Contract)",
    place: "DataAnnotation.Tech",
    summary: "Remote work reviewing and evaluating AI model outputs.",
  },
  {
    period: "Jun 2024 – Feb 2026",
    role: "Software Developer",
    place: "TU Berlin",
    summary:
      "Built and maintained a web platform for learning formal proofs that is now part of the curriculum. Designed its modular backend in Effect, with OpenID Connect login, sessions, PostgreSQL, an OpenAPI contract and a background link to Isabelle.",
  },
  {
    period: "Jul 2025 – Feb 2026, 2019 – 2022",
    role: "Market Sales & Warehouse",
    place: "Knippenbergs",
    summary:
      "Sold speciality cheese at weekly markets, looked after regular customers and worked in the warehouse.",
  },
];

export const now =
  "Practising agentic coding: using AI agents to build new things from scratch, and learning where they help and where they need a firm hand.";

export interface Principle {
  readonly title: string;
  readonly text: string;
}

export const approach: ReadonlyArray<Principle> = [
  {
    title: "Prove it, don't just test it",
    text: "Most of the time it is better to prove that something works than to test that it does.",
  },
  {
    title: "Plan first",
    text: "Planning beforehand removes technical debt and a lot of headaches afterwards.",
  },
];

export const interests: ReadonlyArray<string> = [
  "Good food",
  "Interesting conversations",
  "Music",
];
