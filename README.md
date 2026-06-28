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
- ESLint
- Shared TypeScript configs
- Nix development environment
- Effect TS

---

## Project Structure

Inside the *services* folder you will find the main service applications in this monorepo. Notably this will be the website (frontend) and the backend.

Inside the *lib* folder you will find shared components.

Inside the *apps* folder you will find shared applications used throughout the stack.

---

## Development

#### Dependencies
Either a fully working Node JS Setup including pnpm, or a nix developing system (e.g. NixOS)

#### Run the development server:
```pnpm dev```
Filters are planned to be added, once there are more packages.
If you want to use the nix shell, run  ```nix develop```

---

## Building
Run ```pnpm build```.
Filters are planned to be added here aswell.