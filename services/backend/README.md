# @unhalteproblem.de/backend

The backend of unhalteproblem.de. It implements the HTTP contract from
[`@unhalteproblem.de/api`](../../lib/api): `GET /health`, `POST /contact` and
the browser login under `/auth/*`.
Contact messages are only logged for now.

## Running

- `pnpm --filter @unhalteproblem.de/backend dev` runs `src/main.ts` from source with `node --watch`.
- `pnpm --filter @unhalteproblem.de/backend build` bundles it into `dist/main.js`, and `start` runs that bundle.
- `nix build .#backend-image` builds the container image, and `nixosModules.backend` runs it on a NixOS server (see the root `flake.nix` and `nix/backend-module.nix`).

## Environment

| Variable                    | Default                                                     | Meaning                                                                                                 |
| --------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `PORT`                      | `3000`                                                      | Port to listen on                                                                                       |
| `HOST`                      | `127.0.0.1`                                                 | Interface to bind; the container sets `0.0.0.0`                                                         |
| `LOG_FORMAT`                | `pretty`                                                    | `pretty` or `json`; the container sets `json`                                                           |
| `CONTACT_RATE_LIMIT`        | `5`                                                         | Contact messages per client and window (must be > 0)                                                    |
| `CONTACT_RATE_LIMIT_GLOBAL` | `100`                                                       | Contact messages from all clients together per window (must be > 0)                                     |
| `CONTACT_RATE_LIMIT_WINDOW` | `1 hour`                                                    | Length of that window as an Effect duration, e.g. `10 minutes` (must be > 0)                            |
| `POSTGRES_HOST`             | `localhost`                                                 | Postgres host                                                                                           |
| `POSTGRES_PORT`             | `5432`                                                      | Postgres port                                                                                           |
| `POSTGRES_DB`               | `unhalteproblem`                                            | Database name (must exist)                                                                              |
| `POSTGRES_USER`             | `unhalteproblem`                                            | Database user                                                                                           |
| `POSTGRES_PASSWORD`         | unset                                                       | Database password; set it through an environment file, never in the Nix store                           |
| `OIDC_ISSUER`               | `https://auth.unhalteproblem.de/realms/unhalteproblem-main` | Keycloak realm URL, exactly as Keycloak reports it as `issuer`                                          |
| `OIDC_CLIENT_ID`            | `unhalteproblem-backend`                                    | This backend's client id in that realm                                                                  |
| `OIDC_CLIENT_SECRET`        | required                                                    | The client's secret; set it through an environment file, never in the Nix store                         |
| `PUBLIC_ORIGIN`             | `https://unhalteproblem.de`                                 | Origin of the website: login return target, post-logout target, allowed `Origin` of `POST /auth/logout` |
| `PUBLIC_API_URL`            | `<PUBLIC_ORIGIN>/api`                                       | Public URL of this backend; the login callback is `<PUBLIC_API_URL>/auth/callback`                      |
| `SESSION_MAX_AGE`           | `8 hours`                                                   | How long a login lasts, as an Effect duration (must be > 0)                                             |

Invalid values stop the service at startup instead of being ignored.

## Database

Login state, sessions and users live in Postgres. The database must exist; the
service creates its tables itself. At startup it applies all pending
migrations from `src/migrations/` in one transaction (recorded in
`effect_sql_migrations`) before it serves requests, and it doesn't start if
the database is unreachable or a migration fails.

Migrations are imported statically (`src/services/Database.ts`), because the
service runs as a single bundled file. Committed migrations are never edited;
changes go into a new, numbered migration. Tests run all migrations on an
in-memory PGlite database (`#testing/Database`).

## Domains

Business logic lives in domains under `src/domains/<domain>/`, built on a
small kernel in `src/cqrs/`. For now there is one domain, `users`.

| Kernel (`#cqrs/*`) | Purpose                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Transaction`      | Runs an effect in a database transaction; nested runs become savepoints. Collects the domain events recorded inside and publishes them only after the outermost commit           |
| `DomainEvent`      | `record(...)` adds events to the current transaction (a defect outside one); `DomainEvents` delivers committed events in-process; `subscriber(...)` builds a background consumer |
| `Command`          | `Command.boundary(transaction)`: the last argument of `Effect.fn` for a method that changes state. Runs it in a `Transaction` and turns `SqlError`/`SchemaError` into defects    |
| `Query`            | `Query.boundary`: the same for reads, without a transaction                                                                                                                      |

Events are delivered at most once: they live in memory, so the ones not yet
handled when the process stops are lost, and so are events beyond the queue
capacity (4096) of a subscriber that falls behind (logged as a warning).
Whatever has to happen together with a change belongs into the command
itself, not a subscriber.

Inside a command: open transactions only through `Transaction` (running it
inside a bare `sql.withTransaction`, or recording events inside one, is a
defect), never catch a
`SqlError` and carry on (Postgres would silently roll back the COMMIT; use a
nested `transaction.run` as a savepoint instead), and run statements one
after another, not concurrently.

A domain folder holds:

- the aggregate (`User.ts`): its `Model.Class`, ids, events and errors, and
  the rules as pure functions from the current state to the new state plus
  the events (`register`, `logIn`);
- a repository (`UserRepository.ts`), used only inside the domain;
- `UserCommands` and `UserQueries`, the services the rest of the backend
  uses; every method goes through `Command.boundary` or `Query.boundary`;
- event subscribers (`UserEventLog.ts`) and a layer that wires it all up
  (`Users.ts`).

To add a domain, create `src/domains/<domain>/` the same way, add its tables
in a new migration, and add its layer to `DomainsLive` in
`src/domains/Domains.ts`.

### Users

Every successful login runs `UserCommands.syncFromLogin`. On the first login
it creates a row in `users` with our own UUID and the Keycloak `sub`
(`UserRegistered`); later logins copy Keycloak's current profile
(`preferred_username`, `name`, `email`, `email_verified`) and the login time
(`UserProfileChanged` if the profile differs). Concurrent first logins of the
same user end up with one row. Sessions still reference users by `sub`.

## Client IP and rate limiting

The rate limit is keyed by the `X-Real-IP` header, which nginx sets to the
connecting address. IPv6 clients are grouped by their /64 prefix, because one
connection usually owns a whole /64. On top of the per-client limit there is a
global one, which bounds how much ends up in the log however many addresses a
sender uses. nginx's `limit_req` (set up by the NixOS module) sits in front of
both.

Trusting `X-Real-IP` is only safe while nothing but nginx can reach the
service. The NixOS module publishes the port on `127.0.0.1` only; don't attach
other containers to the backend's network or expose the port elsewhere.
Without the header (local development) the socket address is used. If an nginx
location ever forgets to set it, every visitor shares nginx's address and with
it one quota.

The limiter keeps its state in memory, so it resets when the container
restarts. Request bodies over 32 KiB are rejected before they are read.

## Authentication

Browser login is OpenID Connect against Keycloak, with this backend as a
confidential client (backend for frontend): tokens never reach the browser,
which only gets an HttpOnly session cookie. Authorization (roles) is not
implemented yet.

| Route                           | Purpose                                                                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/login?returnTo=/p`   | Starts a login: stores `state`, `nonce` and the PKCE verifier, sets the `__Host-login` cookie (10 minutes) and redirects to Keycloak                                                                                               |
| `GET /auth/callback`            | Keycloak's redirect target: checks cookie, `state` and `iss`, redeems the code, verifies the ID token, creates the session (`__Host-session`) and returns to `returnTo`; failures go to `/?login_error=cancelled\|expired\|failed` |
| `GET /auth/session`             | The logged-in user, or 401                                                                                                                                                                                                         |
| `POST /auth/logout`             | Ends the session (only with the website's `Origin`) and redirects (303) to Keycloak's logout, which returns to the website                                                                                                         |
| `POST /auth/backchannel-logout` | Called by Keycloak when a session ends there; ends the matching sessions                                                                                                                                                           |

Sessions live in Postgres (only SHA-256 hashes of the cookie values are
stored) and expire after `SESSION_MAX_AGE`; a background job deletes
expired rows every 10 minutes. Tokens are verified with
[jose](https://github.com/panva/jose) against the realm's JWK Set (RS256
only). At startup the backend fetches the discovery document and logs an
error if Keycloak reports a different issuer than `OIDC_ISSUER`.

Keycloak client settings (`OIDC_CLIENT_ID`):

- Client authentication on (confidential), standard flow only (no implicit
  flow, no direct access grants), PKCE method `S256`.
- Valid redirect URI: `<PUBLIC_API_URL>/auth/callback`.
- Valid post logout redirect URI: `<PUBLIC_ORIGIN>/`.
- Back-channel logout URL: `<PUBLIC_API_URL>/auth/backchannel-logout`, with
  "Backchannel logout session required" on.
- Web origins: none needed (the browser never calls Keycloak with `fetch`).
