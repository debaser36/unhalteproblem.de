/**
 * The content of the about page. Plain data, so changing the text never
 * means touching markup.
 */

export const intro = [
  "Hi, I'm Nico. I build software end to end: typed backends, the infrastructure they run on, and the occasional frontend.",
  "This site is my playground for that: notes on what I learn, write-ups of my projects, and the place to reach me.",
];

export interface Skill {
  readonly area: string;
  readonly items: ReadonlyArray<string>;
}

export const expertise: ReadonlyArray<Skill> = [
  {
    area: "Languages",
    items: ["TypeScript", "SQL", "Nix"],
  },
  {
    area: "Backend",
    items: ["Effect", "Node.js", "PostgreSQL", "HTTP APIs", "CQRS"],
  },
  {
    area: "Security",
    items: ["OpenID Connect", "Keycloak", "Role-based access"],
  },
  {
    area: "Infrastructure",
    items: ["NixOS", "Containers", "nginx", "GitHub Actions"],
  },
  {
    area: "Frontend",
    items: ["React", "Tailwind CSS", "Vite"],
  },
];

export interface Experience {
  readonly period: string;
  readonly role: string;
  readonly place: string;
  readonly summary: string;
}

// TODO(Nico): replace these placeholders with your real experience.
export const experience: ReadonlyArray<Experience> = [
  {
    period: "20XX – now",
    role: "Your current role",
    place: "Company",
    summary: "One or two sentences about what you do there.",
  },
  {
    period: "20XX – 20XX",
    role: "A previous role",
    place: "Company",
    summary: "What you built, learned or were responsible for.",
  },
];
