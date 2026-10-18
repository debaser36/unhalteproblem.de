# @unhalteproblem.de/backend

The backend of unhalteproblem.de. It implements the HTTP contract from
[`@unhalteproblem.de/api`](../../lib/api): `GET /health`, `POST /contact` and
the browser login under `/auth/*`. `GET /health` says the process is up;
`GET /ready` also runs `SELECT 1` (2 second timeout) and answers 503 without a
body when the database does not answer. The container image probes `/ready`
every 30 seconds as its healthcheck.
Contact messages are only logged for now.

## Running

- `pnpm --filter @unhalteproblem.de/backend dev` runs `src/main.ts` from source with `node --watch`.
- `pnpm --filter @unhalteproblem.de/backend build` bundles it into `dist/main.js`, and `start` runs that bundle.
- `nix build .#backend-image` builds the container image, and `nixosModules.backend` runs it on a NixOS server (see the root `flake.nix` and `nix/backend-module.nix`).

## Environment

| Variable                     | Default                                                     | Meaning                                                                                                 |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `PORT`                       | `3000`                                                      | Port to listen on                                                                                       |
| `HOST`                       | `127.0.0.1`                                                 | Interface to bind; the container sets `0.0.0.0`                                                         |
| `LOG_FORMAT`                 | `pretty`                                                    | `pretty` or `json`; the container sets `json`                                                           |
| `CONTACT_RATE_LIMIT`         | `5`                                                         | Contact messages per client and window (must be > 0)                                                    |
| `CONTACT_RATE_LIMIT_GLOBAL`  | `100`                                                       | Contact messages from all clients together per window (must be > 0)                                     |
| `CONTACT_RATE_LIMIT_WINDOW`  | `1 hour`                                                    | Length of that window as an Effect duration, e.g. `10 minutes` (must be > 0)                            |
| `POSTGRES_HOST`              | `localhost`                                                 | Postgres host                                                                                           |
| `POSTGRES_PORT`              | `5432`                                                      | Postgres port                                                                                           |
| `POSTGRES_DB`                | `unhalteproblem`                                            | Database name (must exist)                                                                              |
| `POSTGRES_USER`              | `unhalteproblem`                                            | Database user                                                                                           |
| `POSTGRES_PASSWORD`          | unset                                                       | Database password; set it through an environment file, never in the Nix store                           |
| `POSTGRES_MAX_CONNECTIONS`   | `10`                                                        | Size of the connection pool (must be > 0)                                                               |
| `POSTGRES_CONNECT_TIMEOUT`   | `5 seconds`                                                 | How long opening a connection may take, as an Effect duration (must be > 0)                             |
| `POSTGRES_STATEMENT_TIMEOUT` | `30 seconds`                                                | Postgres cancels any statement that runs longer, migrations included (must be > 0)                      |
| `OIDC_ISSUER`                | `https://auth.unhalteproblem.de/realms/unhalteproblem-main` | Keycloak realm URL, exactly as Keycloak reports it as `issuer`                                          |
| `OIDC_CLIENT_ID`             | `unhalteproblem-backend`                                    | This backend's client id in that realm                                                                  |
| `OIDC_CLIENT_SECRET`         | required                                                    | The client's secret; set it through an environment file, never in the Nix store                         |
| `PUBLIC_ORIGIN`              | `https://unhalteproblem.de`                                 | Origin of the website: login return target, post-logout target, allowed `Origin` of `POST /auth/logout` |
| `PUBLIC_API_URL`             | `<PUBLIC_ORIGIN>/api`                                       | Public URL of this backend; the login callback is `<PUBLIC_API_URL>/auth/callback`                      |
| `SESSION_MAX_AGE`            | `8 hours`                                                   | How long a login lasts, as an Effect duration (must be > 0)                                             |

Invalid values stop the service at startup instead of being ignored.

Every connection also gets `idle_in_transaction_session_timeout = 60s`, so a
transaction that is left open releases its locks and its pooled connection.

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
same user end up with one row. The first login also grants
`normalUser` (`user_roles`), in the same transaction. Sessions still
reference users by `sub`.

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
which only gets an HttpOnly session cookie. Roles are described under
"Authorization".

| Route                            | Purpose                                                                                                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/login?returnTo=/p`    | Starts a login: stores `state`, `nonce` and the PKCE verifier, sets the `__Host-login` cookie (10 minutes) and redirects to Keycloak                                                                                               |
| `GET /auth/register?returnTo=/p` | Like `/auth/login`, but asks Keycloak for its registration form (`prompt=create`); after registering, the flow continues as a login                                                                                                |
| `GET /auth/callback`             | Keycloak's redirect target: checks cookie, `state` and `iss`, redeems the code, verifies the ID token, creates the session (`__Host-session`) and returns to `returnTo`; failures go to `/?login_error=cancelled\|expired\|failed` |
| `GET /auth/session`              | The logged-in user, or 401                                                                                                                                                                                                         |
| `POST /auth/logout`              | Ends the session (only with the website's `Origin`) and redirects (303) to Keycloak's logout, which returns to the website                                                                                                         |
| `POST /auth/backchannel-logout`  | Called by Keycloak when a session ends there; ends the matching sessions                                                                                                                                                           |

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

`/auth/register` needs "User registration" on in the realm's login
settings. Whatever Keycloak requires at registration (email verification,
required actions) happens on its pages before it returns to the callback.
The backend's login rate limit only covers starting the flow: Keycloak's
registration form can be reached and submitted without the backend, so
protection against bot sign-ups (verify email, a captcha in the
registration flow, brute force detection) belongs in the realm. Until a
user has verified it, `email` is whatever they typed: never grant anything
based on it unless `emailVerified` is true.

## Authorization

Users have roles: `normalUser`, `admin` and `superAdmin` (`Role` in
`@unhalteproblem.de/api`). They are flat, so no role includes another, and a
user can hold several. Every user gets `normalUser` at registration. They are
stored in `user_roles` and read on every authenticated request (into
`CurrentUser` and `GET /auth/session`), so a granted or revoked role counts
from the user's next request.

Code says which roles it needs in its requirements, with `Authorized` from
the contract, and can't run until someone has checked:

```ts
Effect.gen(function* () {
  // needs admin: Effect<…, …, Authorized<"admin">>
  yield* Authorized("admin");
  // needs admin or superAdmin: Effect<…, …, Authorized<"admin" | "superAdmin">>
  yield* Authorized("admin", "superAdmin");
  // needs admin and superAdmin: require both proofs
  yield* Authorized("admin");
  yield* Authorized("superAdmin");
});
```

A domain service method that does this carries the requirement in its type,
and so does every caller up to the one that provides the proof. Only
`#auth/Authorization` provides proofs; each checks the roles of
`CurrentUser` and fails with `Forbidden` (403):

| Where               | How                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An endpoint         | `RequireRoles("admin")` on the endpoint in the contract (before the group's `Authentication`); `Authorization.middleware(RequireAdmin)` provides its implementation |
| Inside a handler    | `effect.pipe(Authorization.provide("admin"))`                                                                                                                       |
| A per-request layer | `Authorization.layer("admin")`                                                                                                                                      |

A proof satisfies exactly the requirement it was made for:
`Authorized<"admin">` does not satisfy `Authorized<"admin" | "superAdmin">`,
even though an admin would pass that check, so provide what the code asks
for. Denied requests are logged as "Access denied" with the user and the
required roles.

Roles are managed through the admin API (see "Administration"). Only the
first superAdmin has to be made in `psql`; the user must have logged in once,
so that their row in `users` exists. The statement also writes the role
change log, with `changed_by` NULL for "an operator":

```sql
\set subject 'the-keycloak-sub'

-- grant superAdmin (INSERT 0 0: never logged in, or already has it)
WITH granted AS (
  INSERT INTO user_roles (user_id, role, granted_at)
  SELECT id, 'superAdmin', now() FROM users WHERE subject = :'subject'
  ON CONFLICT (user_id, role) DO NOTHING
  RETURNING user_id, role, granted_at
)
INSERT INTO user_role_changes (user_id, role, change, changed_at)
SELECT user_id, role, 'granted', granted_at FROM granted;
```

A new role needs a migration that changes the `user_roles_role_check` and
`user_role_changes_role_check` constraints, and the `Role` schema in the
contract.

## Administration

The `admin` group of the contract, under `/admin`. Every endpoint needs a
session (401) and a role (403); the state-changing ones also need the
website's `Origin` (`SameOrigin`, 403 otherwise), because the SameSite=Lax
session cookie still reaches the backend from same-site pages such as
`auth.unhalteproblem.de`.

| Endpoint                                 | Role         | Does                                                      |
| ---------------------------------------- | ------------ | --------------------------------------------------------- |
| `GET /admin/users?limit&offset`          | `admin`      | Lists users with all fields, roles and active restriction |
| `GET /admin/users/:id`                   | `admin`      | One user, with restriction history and role change log    |
| `POST /admin/users/:id/restriction`      | `admin`      | Restricts the account, with a note                        |
| `POST /admin/users/:id/restriction/lift` | `admin`      | Lifts the active restriction, with an optional note       |
| `PUT /admin/users/:id/roles/:role`       | `superAdmin` | Grants a role                                             |
| `DELETE /admin/users/:id/roles/:role`    | `superAdmin` | Revokes a role                                            |

Roles are flat here too: a superAdmin needs `admin` as well to use the
admin endpoints. `:id` is our user id (`users.id`), not the Keycloak `sub`.

- **Roles.** Granting a held role and revoking one that isn't held change
  nothing. Nobody revokes their own `superAdmin`, and the last superAdmin
  keeps it (`RoleChangeNotAllowed`); revocations lock all superAdmin grants,
  so two concurrent ones can't both succeed. Every change is logged in
  `user_role_changes` with who made it.
- **Restrictions.** A restricted account is blocked until an admin lifts the
  restriction: its sessions are deleted at once, `Authentication` refuses
  restricted users on every request anyway (401), and the login callback
  refuses them with `login_error=restricted` (Keycloak itself still lets them
  log in). One restriction can be active per user; all of them are kept in
  `user_restrictions`, with who restricted and lifted, when, and the notes.
  Nobody restricts or lifts themselves, and only a superAdmin acts on an
  admin or superAdmin (`RestrictionNotAllowed`).

Each command locks the actor's and the target's `users` rows (in id
order, `FOR NO KEY UPDATE`) and reads both again under the lock. A moderator
who lost the needed role or was restricted since their request started is
refused with `Forbidden`; so two superAdmins restricting each other at the
same moment can't both succeed. Lifting a restriction ends the user's
sessions once more, in case a login raced the restriction.

Don't delete `users` rows by hand: their roles and restrictions go with them
(`ON DELETE CASCADE`), while sessions, keyed by the Keycloak `sub`, stay
valid with no roles. Restrict the account instead.

The notes are visible to admins only and stay out of the logs; the domain
events (`RoleGranted`, `RoleRevoked`, `UserRestricted`, `RestrictionLifted`)
are logged with ids only.
