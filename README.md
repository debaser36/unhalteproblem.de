# Personal Website (Monorepo)

A monorepo-based personal website built with TypeScript, PNPM workspaces, Turborepo, and a Vite + React frontend. A backend written fully in [Effect TS](https://effect.website) is planned.

---

## Status

![License](https://img.shields.io/badge/license-MIT-blue)
![pnpm](https://img.shields.io/badge/pnpm-workspace-f69220)
![Turbo](https://img.shields.io/badge/turborepo-monorepo-000000)
![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6)

---

## Tech Stack

- PNPM workspaces
- Turborepo
- React + TypeScript
- Vite
- PostCSS
- oxlint
- Shared TypeScript configs
- Nix development environment
- Effect TS

---

## Project Structure

Inside the _services_ folder you will find the main service applications in this monorepo. Notably this will be the website (frontend) and the backend.

Inside the _lib_ folder you will find shared components.

Inside the _apps_ folder you will find shared applications used throughout the stack.

---

## Development

#### Dependencies

Either a fully working Node JS Setup including pnpm, or a nix developing system (e.g. NixOS)

#### Run the development server:

`pnpm dev`
Filters are planned to be added, once there are more packages.
If you want to use the nix shell, run `nix develop`

#### Try a feature in the real app (`nix develop`)

Inside `nix develop`, `stack up` starts a throwaway Postgres, the backend and
the website, and seeds a logged-in superadmin (Keycloak is not involved):

| Command                             | What it does                                                        |
| ----------------------------------- | ------------------------------------------------------------------- |
| `stack up` / `stack down`           | Start / stop everything. The data stays in the git-ignored `.dev/`. |
| `stack status`, `stack logs [name]` | What runs; follow the `postgres`, `backend` or `web` log.           |
| `stack login [user] [roles]`        | Seed a user and print its `__Host-session` cookie.                  |
| `stack shot <path> [file] [--user]` | Headless Chromium screenshot of a page, e.g. `stack shot /admin`.   |
| `stack psql`                        | `psql` on the database.                                             |
| `stack reset`                       | Stop and delete `.dev/`, so the next `up` starts from an empty DB.  |

Website <http://localhost:5173>, backend <http://127.0.0.1:3100>, Postgres
`127.0.0.1:54329` (override with `STACK_WEB_PORT`, `STACK_BACKEND_PORT`,
`STACK_PG_PORT`). Secrets like `STRIPE_SECRET_KEY` are read from `.env`. To
use the seeded login in your own browser, set the cookie `__Host-session` to
the value `stack login` prints.

---

## Building

Run `pnpm build`.
Filters are planned to be added here aswell.
