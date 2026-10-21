---
name: run-local
description: Start the website and backend locally against a throwaway Postgres, with a seeded admin session, to take screenshots or check a change in the real app. Use when asked to run the app, screenshot a page or verify UI/API behaviour end to end.
---

Recipe for a local stack without Keycloak. Do the setup in a scratchpad
directory outside the repo, and stop every process you start when you are done.

1. **Postgres.** `initdb` a fresh cluster in the scratchpad and start it with
   TCP only (`-c listen_addresses=127.0.0.1 -c unix_socket_directories=''`).
   The unix socket path is too long inside the scratchpad. Create the
   database the backend expects (see "Environment" in
   `services/backend/README.md` for the connection variables).
2. **Backend.** Start `pnpm --filter @unhalteproblem.de/backend dev` with the
   database variables and `OIDC_ISSUER` pointing at an address nothing
   listens on, plus `OIDC_CLIENT_SECRET=dev`. The backend runs the migrations
   on start; login itself does not work, which is why step 3 exists.
3. **Admin session.** Insert a user and a session row directly with SQL
   (tables `users`, `user_roles`, `auth_sessions`; read
   `src/migrations/0001_create_auth_tables.ts` and the users migration for the
   columns). The `__Host-session` cookie holds a known random value and the
   row's `id_hash` is the sha256 of it (see `services/backend/docs/authentication.md`).
4. **Website.** `BACKEND_URL=http://127.0.0.1:3000 pnpm --filter @unhalteproblem.de/website dev`;
   Vite proxies `/api` to the backend.
5. **Screenshots / checks.** Drive the page with `playwright-core` and a
   Chromium from `nix build nixpkgs#chromium` (unset `LD_LIBRARY_PATH`). Send
   the cookie with `extraHTTPHeaders`.

Cleanup: kill the processes by PID. Never `pkill -f <pattern>` with a pattern
that also matches your own shell command.
