---
name: run-local
description: Start the website and backend locally against a throwaway Postgres, with a seeded admin session, to take screenshots or check a change in the real app. Use when asked to run the app, screenshot a page or verify UI/API behaviour end to end.
---

The local stack is the `stack` command of the dev shell (`nix/stack.sh`, built
in `flake.nix`); there is nothing to set up by hand. Run it inside
`nix develop` (from outside: `nix develop --command stack …`). `stack help`
lists everything.

1. `stack up` starts Postgres, the backend and the website, and seeds a
   superadmin with a session. The backend migrates on start, and login via
   Keycloak does not work (the OIDC issuer points at a closed port).
   Website `http://localhost:5173`, backend `http://127.0.0.1:3100`, data in
   the git-ignored `.dev/` (it survives `stack down`; `stack reset` wipes it).
2. `stack login <user> [role,role]` seeds another user (roles from
   `normalUser,admin,superAdmin,foodPlanner`) and prints the
   `__Host-session=…` cookie for `curl -H 'Cookie: …'` against the backend.
3. `stack shot <path> [file.png] [--user name] [--full]` takes a screenshot as
   that user; read the PNG with the Read tool. Anything more elaborate
   (clicks, forms) is a script on `playwright-core` at `$PLAYWRIGHT_CORE`
   with `executablePath: $CHROMIUM_EXECUTABLE` (see `nix/stack-shot.mjs`).
4. `stack psql` for the database, `stack logs [backend|web|postgres]` when
   something fails (`stack up` prints the log if the backend crashes).
5. `stack down` when done. Other processes on this machine may hold ports
   3000/5173; `stack up` refuses to start over them, and the ports can be
   changed with `STACK_BACKEND_PORT`, `STACK_WEB_PORT`, `STACK_PG_PORT`.

Stripe and Anthropic keys come from `.env` if present; without them those
features answer as unconfigured.
