# @unhalteproblem.de/backend

The backend of unhalteproblem.de. It implements the HTTP contract from
[`@unhalteproblem.de/api`](../../lib/api): `GET /health`, `POST /contact` and
the browser login under `/auth/*`. `GET /health` says the process is up;
`GET /ready` also runs `SELECT 1` (2 second timeout) and answers 503 without a
body when the database does not answer. The container image probes `/ready`
every 30 seconds as its healthcheck.
Contact messages are stored in Postgres and mailed to the owner (see "Contact"
below).

## Running

- `pnpm --filter @unhalteproblem.de/backend dev` runs `src/main.ts` from source with `node --watch`.
- `pnpm --filter @unhalteproblem.de/backend build` bundles it into `dist/main.js`, and `start` runs that bundle.
- `nix build .#backend-image` builds the container image, and `nixosModules.backend` runs it on a NixOS server (see the root `flake.nix` and `nix/backend-module.nix`).

## Environment

| Variable                       | Default                                                     | Meaning                                                                                                             |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `PORT`                         | `3000`                                                      | Port to listen on                                                                                                   |
| `HOST`                         | `127.0.0.1`                                                 | Interface to bind; the container sets `0.0.0.0`                                                                     |
| `LOG_FORMAT`                   | `pretty`                                                    | `pretty` or `json`; the container sets `json`                                                                       |
| `LOG_LEVEL`                    | `Info`                                                      | Least severe level that is logged: `Debug`, `Info`, `Warn` or `Error`; `Debug` adds `/health` and `/ready` requests |
| `CONTACT_RATE_LIMIT`           | `5`                                                         | Contact messages per client and window (must be > 0)                                                                |
| `CONTACT_RATE_LIMIT_GLOBAL`    | `100`                                                       | Contact messages from all clients together per window (must be > 0)                                                 |
| `CONTACT_RATE_LIMIT_WINDOW`    | `1 hour`                                                    | Length of that window as an Effect duration, e.g. `10 minutes` (must be > 0)                                        |
| `LOGIN_RATE_LIMIT`             | `30`                                                        | Login starts per client and window (must be > 0)                                                                    |
| `LOGIN_RATE_LIMIT_GLOBAL`      | `3000`                                                      | Login starts from all clients together per window (must be > 0)                                                     |
| `LOGIN_RATE_LIMIT_WINDOW`      | `10 minutes`                                                | Length of that window as an Effect duration (must be > 0)                                                           |
| `POSTGRES_HOST`                | `localhost`                                                 | Postgres host                                                                                                       |
| `POSTGRES_PORT`                | `5432`                                                      | Postgres port                                                                                                       |
| `POSTGRES_DB`                  | `unhalteproblem`                                            | Database name (must exist)                                                                                          |
| `POSTGRES_USER`                | `unhalteproblem`                                            | Database user                                                                                                       |
| `POSTGRES_PASSWORD`            | unset                                                       | Database password; set it through an environment file, never in the Nix store                                       |
| `POSTGRES_MAX_CONNECTIONS`     | `10`                                                        | Size of the connection pool (must be > 0)                                                                           |
| `POSTGRES_CONNECT_TIMEOUT`     | `5 seconds`                                                 | How long opening a connection may take, as an Effect duration (must be > 0)                                         |
| `POSTGRES_STATEMENT_TIMEOUT`   | `30 seconds`                                                | Postgres cancels any statement that runs longer, migrations included (must be > 0)                                  |
| `OIDC_ISSUER`                  | `https://auth.unhalteproblem.de/realms/unhalteproblem-main` | Keycloak realm URL, exactly as Keycloak reports it as `issuer`                                                      |
| `OIDC_CLIENT_ID`               | `unhalteproblem-backend`                                    | This backend's client id in that realm                                                                              |
| `OIDC_CLIENT_SECRET`           | required                                                    | The client's secret; set it through an environment file, never in the Nix store                                     |
| `KEYCLOAK_ADMIN_CLIENT_ID`     | `unhalteproblem-backend-admin`                              | The Keycloak client that deletes users (a different one than `OIDC_CLIENT_ID`)                                      |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | required                                                    | Its secret; set it through an environment file, never in the Nix store                                              |
| `PUBLIC_ORIGIN`                | `https://unhalteproblem.de`                                 | Origin of the website: login return target, post-logout target, allowed `Origin` of `POST /auth/logout`             |
| `PUBLIC_API_URL`               | `<PUBLIC_ORIGIN>/api`                                       | Public URL of this backend; the login callback is `<PUBLIC_API_URL>/auth/callback`                                  |
| `SESSION_MAX_AGE`              | `8 hours`                                                   | How long a login lasts, as an Effect duration (must be > 0)                                                         |
| `CONTACT_RETENTION`            | `90 days`                                                   | How long contact messages are kept before they are deleted (must be > 0)                                            |
| `AUDIT_RETENTION`              | `365 days`                                                  | How long audit log entries are kept before they are deleted (must be > 0)                                           |
| `SMTP_HOST`                    | unset                                                       | SMTP server for the mails about contact messages. Unset: messages are stored but not mailed                         |
| `SMTP_PORT`                    | `587` (`465` with `tls`)                                    | SMTP port                                                                                                           |
| `SMTP_SECURITY`                | `starttls`                                                  | `starttls`, `tls`, or `none` (plain text, only accepted for `localhost`, e.g. Mailpit)                              |
| `SMTP_USER`                    | unset                                                       | SMTP login; then `SMTP_PASSWORD` is required (set it through an environment file)                                   |
| `SMTP_FROM`                    | required with `SMTP_HOST`                                   | Sender of the mails, e.g. `Website <noreply@unhalteproblem.de>`                                                     |
| `CONTACT_MAIL_TO`              | required with `SMTP_HOST`                                   | Who gets the mails about contact messages                                                                           |

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

### Long-running migrations

Pending migrations run at startup, all in one transaction, before the
service listens. That is simple and safe for the small tables here, and it
has consequences once a migration takes a while:

- **The deploy waits.** Until the migrations commit, the new container
  serves nothing, and the healthcheck (`/ready`) has its start period of 20
  seconds. A migration that needs minutes makes the unit look unhealthy and
  can be restarted in the middle, which rolls the whole transaction back and
  starts over. Run slow ones by hand first (below).
- **`POSTGRES_STATEMENT_TIMEOUT` (30 seconds) applies to migrations too.**
  A statement that runs longer is cancelled and the service doesn't start.
  For a deploy with a known-slow migration, raise it for that one start and
  remove it afterwards.
- **Locks.** `ALTER TABLE` and plain `CREATE INDEX` take locks that block
  writes (or everything) on the table while they run, and wait behind
  running transactions. On a big, busy table that stalls requests. Prefer
  the steps that don't: add nullable columns without a default, add
  constraints as `NOT VALID` and `VALIDATE CONSTRAINT` in a later migration,
  and split a risky change into expand (add, backfill) and contract (remove
  the old) over two deploys, so the old and the new version both work
  against the intermediate schema.
- **`CREATE INDEX CONCURRENTLY` can't run in a transaction**, so it can't be
  a migration. Create the index by hand beforehand, then write the migration
  with `CREATE INDEX IF NOT EXISTS` (a no-op there, and the real thing for a
  fresh database such as the tests):

  ```sh
  sudo -u postgres psql unhalteproblem \
    -c 'CREATE INDEX CONCURRENTLY IF NOT EXISTS users_x_idx ON users (x)'
  ```

- **Backfills** of many rows belong in batches, outside the migration
  (a script, or an outbox job), not in one statement.

Take a backup before a risky migration (`systemctl start
unhalteproblem-backup`, see "Backups"): migrations are irreversible by
design, so a restore is the way back.

### Backups

The NixOS module can dump the database regularly
(`services.unhalteproblem-backend.backup.enable = true;`, needs
`services.postgresql` on the same host). `unhalteproblem-backup.service` runs
daily (`backup.startAt`) as the postgres user:

1. `pg_dump --format=custom` into `backup.location`
   (`/var/backup/unhalteproblem/<db>-<date>.dump`, mode 0700 directory).
2. **Restores that dump into a scratch database** and checks that it holds as
   many applied migrations as the live database (`nix/verify-backup.sh`),
   then drops the scratch database (and any left over by a run that could not
   drop it). A dump that fails is renamed to `*.dump.failed`, so the newest
   `*.dump` is always a proven one, and the unit fails instead of the problem
   sitting unnoticed until the day it is needed. **Nothing alerts you**: watch
   `systemctl --failed` or hook an alert to the unit. The timer is
   persistent, so a run missed while the machine was off happens at boot.
3. Only then deletes dumps (and failed ones) older than `backup.keepDays` (14).

The dumps contain everything, personal data included, and live on the same
machine as the database. Accounts users deleted
are still in the dumps until they age out (`keepDays`, plus any copy you took
off the machine). Copy them to another place (restic, rsync, a
provider's object storage) from `backup.location`; that part is not
automated here. Check a dump from anywhere with
`PGUSER=… bash nix/verify-backup.sh <dump>` (a Postgres of the same version
as the server).

To restore after losing the database:

```sh
systemctl stop podman-unhalteproblem-backend   # the container (docker-… with docker)
sudo -u postgres dropdb --if-exists unhalteproblem
sudo -u postgres createdb --owner unhalteproblem unhalteproblem
sudo -u postgres pg_restore --role unhalteproblem --no-owner \
  --exit-on-error --dbname unhalteproblem /var/backup/unhalteproblem/<dump>
systemctl start podman-unhalteproblem-backend
```

`--role` makes the backend's user own the restored tables. The dump includes
`effect_sql_migrations`, so the backend finds the schema up to date (or
applies the migrations that are newer than the dump). Sessions in the dump
are restored too; those that expired meanwhile are cleaned up as usual.

## Domains

Business logic lives in domains under `src/domains/<domain>/`, built on a
small kernel in `src/cqrs/`. The domains are `users`, `moderation`,
`audit`, `contact`, `blogs`, `projects` and `media`.

| Kernel (`#cqrs/*`) | Purpose                                                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Transaction`      | Runs an effect in a database transaction; nested runs become savepoints. Collects the domain events recorded inside and publishes them only after the outermost commit                                                 |
| `DomainEvent`      | `record(...)` adds events to the current transaction (a defect outside one); `DomainEvents` delivers committed events in-process; `subscriber(...)` builds a background consumer                                       |
| `Command`          | `Command.boundary(transaction)`: the last argument of `Effect.fn` for a method that changes state. Runs it in a `Transaction` and turns `SqlError`/`SchemaError` into defects                                          |
| `Query`            | `Query.boundary`: the same for reads, without a transaction                                                                                                                                                            |
| `Outbox`           | Durable side effects: `enqueue(topic, payload)` inside a command writes a row in the same transaction; `Outbox.consumer(topic, handle)` is a background worker that handles committed rows at least once, with retries |

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

### Outbox

For a side effect that must not be lost (sending a mail, telling another
system), events are the wrong tool: they are in memory and at most once.
Instead the command calls `Outbox.enqueue(topic, payload)`, which writes a row
to `outbox` in the same transaction as the state change (it dies outside a
`Transaction.run`, and rolls back with it). A background worker,
`Outbox.consumer(topic, handle)` in the domain's layer, claims committed rows
(`FOR UPDATE SKIP LOCKED`, reserved with a lease), runs `handle` outside any
transaction and deletes the row when it succeeds.

- Delivery is **at least once**: a worker that dies after the side effect and
  before the delete, or a lease that ran out, causes a second run. Handlers
  must be idempotent.
- Each message is reserved (5 minutes) just before its handler runs, and a
  worker that lost the reservation can no longer complete or fail it. A
  message whose workers keep dying is abandoned once its attempts are used up.
- A failed attempt is logged with its cause and retried with backoff
  (30 seconds, doubling, at most an hour). A payload that no longer decodes
  is given up on at once. After 10 attempts the row gets
  `dead_at` and stays for inspection; `last_error` holds only the kind of
  failure, never its text, since errors tend to quote personal data.
- Payloads are described by a schema (`Outbox.topic(name, schema)`), so a
  payload that no longer decodes after a deploy fails like any other attempt.
- Look at what is stuck with
  `SELECT id, topic, attempts, last_error, dead_at FROM outbox ORDER BY id`.

### Users

Every successful login runs `UserCommands.syncFromLogin`. On the first login
it creates a row in `users` with our own UUID and the Keycloak `sub`
(`UserRegistered`); later logins copy Keycloak's current profile
(`preferred_username`, `name`, `email`, `email_verified`) and the login time
(`UserProfileChanged` if the profile differs). Concurrent first logins of the
same user end up with one row. The first login also grants
`normalUser` (`user_roles`), in the same transaction. Sessions still
reference users by `sub`.

### Moderation

`domains/moderation` owns who holds which role and who is restricted
(`ModerationCommands`: `grantRole`, `revokeRole`, `restrict`,
`liftRestriction`, and `grantInitialRoles` for registration;
`ModerationQueries`: `accessOf`, `standingOf`, `historyOf`). The domains
depend on each other in one direction per layer, so there is no cycle:
moderation acts on users through `UserDirectory` (find and lock a user,
nothing else of the users domain), and `UserCommands.syncFromLogin` calls
`ModerationCommands.grantInitialRoles` inside its own transaction (a
savepoint), so a user never exists without their first role. `UserQueries`
composes the admin overview from `ModerationQueries`. `DomainsLive` wires
it: users' directory, then moderation, then the rest of users.

## Audit log

`audit_log` (domain `audit`, `AuditCommands.record`) remembers who did what
to whom, for the people who run the site. One row per action: when, which
action, the acting and the affected user (our ids), and a short qualifier
(the role of a role change).

| Action                                  | Written                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `role_granted`, `role_revoked`          | by the moderation command, in its transaction; only if it changed something     |
| `user_restricted`, `restriction_lifted` | by the moderation command, in its transaction                                   |
| `account_deleted`                       | by `UserCommands.deleteAccount`, in its transaction                             |
| `login`                                 | by the login callback, before the session is created (no entry, no session)     |
| `logout`, `login_refused`               | by `POST /auth/logout` and the login callback; best effort, a failure is logged |

A row written inside a command exists exactly when the change does (it joins
the transaction), and a refused or no-op command leaves none. Not recorded:
logouts that Keycloak starts (back-channel) and the registration of a user
with their first role. The log holds ids only, never names, addresses,
restriction notes or IPs, because it is kept for `AUDIT_RETENTION` (a year by
default; a job deletes older rows once a day). Rows are never updated. Read
them with, for example,
`SELECT at, action, actor_id, target_id, detail FROM audit_log WHERE target_id = '…' ORDER BY id`.

## Logging

Every request gets an id: `X-Request-Id` from nginx (which sets it to its own
`$request_id`) when it looks like one, else a fresh UUID. It is returned as
`X-Request-Id` and annotates every log line written while the request runs, so
one request can be followed through the log and matched to nginx's access log.
When a request ends, `RequestLogging` logs `Sent HTTP response` with method,
path, status, duration and the client's rate-limit key (see below). The query is
never logged, since it holds OIDC codes and state. `/health` and `/ready` are
logged at debug level, 5xx responses at error level with their cause.

## Contact

`POST /contact` (rate limited, see below) runs `ContactCommands.submit` of the
`contact` domain: in one transaction it stores the message in
`contact_messages` and enqueues a `contact.send-mail` outbox message. A
consumer then mails the owner (`CONTACT_MAIL_TO`) with the visitor's address
as `Reply-To`, so answering the mail answers them. If the SMTP server is down
the mail is retried with backoff (see "Outbox"); a mail may rarely arrive
twice, which is why it carries a stable `Message-ID`. Without `SMTP_HOST` the
messages are stored only, and a warning without content is logged for each.

If the mails don't arrive, look at the outbox and the log:
`SELECT id, attempts, last_error, available_at, dead_at FROM outbox WHERE topic = 'contact.send-mail'`.
`last_error` is `MailFailed:` and a code, `<code>[:<SMTP reply>[:<command>]]`
(the same appears in the log line "Outbox message failed", which also carries the
server's explanation of a refusal with anything that looks like an address
replaced by `<address>`; the table never gets that text, since the
server quotes addresses in it):

| Code                               | Usually                                                                                                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ECONNECTION`, `ETIMEDOUT`, `EDNS` | host or port wrong, firewall (Oracle Cloud blocks outgoing port 25: use 587 or 465), no DNS                                                                                                                                                           |
| `ESOCKET`                          | TLS mismatch: port 465 needs `SMTP_SECURITY=tls`, port 587 `starttls`                                                                                                                                                                                 |
| `EAUTH:535:…`                      | wrong `SMTP_USER` or `SMTP_PASSWORD` (some providers need an app password)                                                                                                                                                                            |
| `EENVELOPE:…:MAIL FROM`            | the provider doesn't allow `SMTP_FROM` as sender (often it must be the login address or a verified domain)                                                                                                                                            |
| `EENVELOPE:…:RCPT TO`              | the provider refuses `CONTACT_MAIL_TO`                                                                                                                                                                                                                |
| `EMESSAGE:550:DATA`                | the provider accepted login, sender and recipient but refuses the message itself: usually the sender domain isn't verified there (SPF/DKIM/DMARC), or the visitor's Reply-To domain has no mail server; the log line carries the server's explanation |

A message is retried with backoff and ends up dead (`dead_at`) after ten
attempts. After fixing the setting and restarting, run the failed ones again:
`UPDATE outbox SET attempts = 0, available_at = now(), last_error = NULL, dead_at = NULL, locked_until = NULL WHERE topic = 'contact.send-mail'`.

The table holds names, addresses and free text. Nothing logs them (not even
the outbox: its payload is the message id), and a job deletes messages older
than `CONTACT_RETENTION` once an hour. Read the stored ones with
`SELECT created_at, name, email, message FROM contact_messages ORDER BY created_at DESC`.

## Blogs

The website has several subblogs (`blogs`), each with its posts
(`blog_posts`), in the domain `blogs`. Admins create and rename subblogs
(`POST /admin/blogs`, `PATCH /admin/blogs/:blog`); a subblog's slug never
changes, since it is in URLs and in roles. Its posts are written in place on
the website by the holders of **`blogEditor:<slug>`**, granted by superAdmins
like any role (`PUT /admin/users/:id/roles/blogEditor:<slug>`, 404
`BlogNotFound` for a subblog that doesn't exist, so no editor role waits for
one that might be created later).

| Endpoints                                 | Who                 | Does                                                          |
| ----------------------------------------- | ------------------- | ------------------------------------------------------------- |
| `GET /blogs`, `/blogs/:blog`              | everyone            | Subblogs, with their number of published posts                |
| `GET /blogs/:blog/posts`, `/posts`        | everyone            | Published posts, newest first, paged by keyset cursor         |
| `GET /blogs/:blog/posts/:post`            | everyone            | One published post, by slug                                   |
| `/blogs/:blog/manage/posts[/:postId[/…]]` | `blogEditor:<blog>` | All posts, drafts included; create, save, (un)publish, delete |
| `POST /blogs/:blog/manage/media`          | `blogEditor:<blog>` | Uploads an image (see "Media")                                |

- **Authorization.** The editor endpoints need a session (401) and the role
  for the subblog in their path (403); the handler provides
  `Authorized(blogEditorRole(blog))`, and every command and query requires
  the proof for the subblog it acts on. A proof for another subblog has the
  same type but a different service key, so it is missing at runtime: the
  request fails, it is never let through. Writes also need the website's
  `Origin`. Admins are not editors: an admin who wants to write grants
  themselves the role (which is logged).
- **Drafts and publishing.** A post is created as a draft and is only public
  while published. `published_at` is set at the first publication and kept
  when a post goes back to draft and is published again, so a republished
  post doesn't jump to the top of the feed.
- **Concurrent edits.** Every save sends the `version` it started from; if
  someone saved in between, it fails with 409 `PostEditConflict` (with the
  current version) instead of overwriting their work. Every change bumps the
  version.
- **Content.** Posts are TipTap (ProseMirror) JSON, validated by the
  contract's `Document` schema: a whitelist of node types, marks and
  attributes, links only to http(s), mailto or the site itself, images only
  from `/api/media/<id>`. No HTML is ever stored. Saving a post may send up
  to 512 KiB (`LargeBody`); nginx allows it on `/api/blogs/*/manage/` and
  `/api/admin/projects`.
- **Authors.** A post names its author (`users.name`, else the username)
  while their account exists; a deleted account's posts stay, without a
  name.

Look at the posts of a subblog with
`SELECT p.slug, p.status, p.published_at, p.version FROM blog_posts p JOIN blogs b ON b.id = p.blog_id WHERE b.slug = '…' ORDER BY p.updated_at DESC`.

## Projects

The projects page shows the owner's projects (`projects`, domain
`projects`): a write-up each (a `Document`, like posts), links to the source
(`repoUrl`) and to the project itself (`liveUrl`), tags, a status (`active`,
`completed`, `archived`) and an optional cover. Admins write them in place
on the website (`/admin/projects`, `RequireAdmin`, writes with the website's
`Origin`); only published ones are public (`GET /projects`,
`GET /projects/:project`). The page lists featured projects first, then by
`position` (ascending), then the most recently changed. Saves carry the
version they started from, as for posts (409 `ProjectEditConflict`).
Images go to the media store with the scope `projects`
(`POST /admin/projects/media`). URLs must be absolute http(s) URLs without
credentials; the database checks the scheme as well.

## Media

Images for posts are uploaded with `POST /blogs/:blog/manage/media`
(multipart, one part `file`, at most 5 MiB) and stored in Postgres
(`media`, domain `media`), with the scope they were uploaded for
(`blog:<slug>`; project images, uploaded with `POST /admin/projects/media`,
get `projects`). The type is detected from the content (PNG, JPEG, GIF,
WebP, AVIF; 415 otherwise), never taken from the client; SVG is refused on
purpose, since it can carry script. `media.sha256` must be the SHA-256 of
the data (a check).

`GET /media/:mediaId` serves an image to everyone who knows its id, also
when it belongs to a draft: ids are random UUIDs, and whoever has the
draft's text can see its images anyway. The response may be cached for good
(an image never changes under its id) and carries `nosniff`, a sandboxing
CSP and `Cross-Origin-Resource-Policy: same-origin`. Nothing deletes images
yet, not even ones no post uses any more; find those with
`SELECT id, byte_size, uploaded_at FROM media m WHERE NOT EXISTS (SELECT 1 FROM blog_posts p WHERE p.cover_media_id = m.id OR p.content::text LIKE '%' || m.id || '%')`.

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
- Logout: the backend keeps no ID token (a credential at rest), so its
  redirect to Keycloak carries no `id_token_hint`, and Keycloak asks the
  user to confirm before it ends its session and returns to the website.
- Back-channel logout URL: `<PUBLIC_API_URL>/auth/backchannel-logout`, with
  "Backchannel logout session required" on.
- Web origins: none needed (the browser never calls Keycloak with `fetch`).
- A second client for deleting accounts (see "Account deletion"): service
  account with `manage-users` of `realm-management`, no login flows.

`/auth/register` needs "User registration" on in the realm's login
settings. Whatever Keycloak requires at registration (email verification,
required actions) happens on its pages before it returns to the callback.
The backend's login rate limit only covers starting the flow: Keycloak's
registration form can be reached and submitted without the backend, so
protection against bot sign-ups (verify email, a captcha in the
registration flow, brute force detection) belongs in the realm. Until a
user has verified it, `email` is whatever they typed: never grant anything
based on it unless `emailVerified` is true.

## Account deletion

`POST /account/delete` (session and the website's `Origin`, like the admin
writes) lets users delete their own account. `UserCommands.deleteAccount`
does it in one transaction:

- the user's row stays as a **tombstone**: username, name and email are
  cleared, `email_verified` is false, `deleted_at` is set (a database check
  makes sure a deleted row is cleared). The id and the Keycloak `sub` stay,
  because the audit log and restrictions point at the id and the `sub` tells
  a login during the next step that this account is gone;
- all their roles are removed (logged in the role change log as revoked, with
  no actor), all their sessions are deleted, and the response clears the
  session cookie;
- an `account_deleted` audit entry is written and an outbox message
  `account.delete-keycloak-user` is enqueued. The consumer then calls
  Keycloak's admin API (`DELETE /admin/realms/<realm>/users/<sub>`) with the
  backend client's service account; a user that is gone already counts as
  deleted, and a failure is retried with backoff (see "Outbox").

A deleted account is treated like a restricted one: no session works and a
login ends in `login_error=restricted`, until Keycloak has deleted the user
(after which they could register anew, as a new user). Admins still see the
tombstone in the user list (`deletedAt`). **A superAdmin cannot delete their
account** (409 `AccountDeletionNotAllowed`): another superAdmin has to revoke
their role first, so the site never loses its last one by accident. Nothing
can undo a deletion; restore from a backup if it was a mistake. Restriction
notes an admin wrote about the user stay, as do the role change log and the
audit log (ids only): they are records about what admins did.
Backups (see there) and the request log (`client.key`, the client's IPv4
address or IPv6 /64) also keep things for as long as you keep them.

Keycloak setup for the deletion: it uses **a client of its own**
(`KEYCLOAK_ADMIN_CLIENT_ID`, default `unhalteproblem-backend-admin`, secret in
`KEYCLOAK_ADMIN_CLIENT_SECRET`), never the login client, so the secret that
every login uses cannot also delete users. The service refuses to start if
both ids are the same. In the admin console, in the realm of `OIDC_ISSUER`:

1. Clients → Create client: client type OpenID Connect, client ID as above.
2. Capability config: "Client authentication" on, "Service accounts roles" on,
   and every flow off (standard flow, direct access grants, implicit flow).
3. Tab Credentials: copy the client secret into `KEYCLOAK_ADMIN_CLIENT_SECRET`.
4. Tab Service accounts roles → Assign role → filter by clients →
   `realm-management` → `manage-users`. Nothing else.

Without it the outbox messages end up dead after their attempts
(`SELECT topic, attempts, last_error FROM outbox WHERE dead_at IS NOT NULL`,
`last_error` is `delete:403` or `token:401`), and the Keycloak user remains.

## Authorization

Users have roles: `normalUser`, `admin` and `superAdmin` (`Role` in
`@unhalteproblem.de/api`), and `blogEditor:<slug>`, which lets its holder
edit the posts of the subblog `<slug>` (lowercase letters and digits in
groups joined by hyphens, at most 64 characters). superAdmins grant and
revoke it through the admin API like any other role. Roles are flat, so no
role includes another, and a user can hold several. Every user gets
`normalUser` at registration. Roles are stored in `user_roles` and read on every authenticated request, in the same
query as the session (`#auth/SessionAccess`; into
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
contract. A new `blogEditor:<slug>` role for another subblog needs neither:
the constraints accept any well-formed slug (since migration 0012).

## Administration

The `admin` group of the contract, under `/admin`. Every endpoint needs a
session (401) and a role (403); the state-changing ones also need the
website's `Origin` (`SameOrigin`, 403 otherwise), because the SameSite=Lax
session cookie still reaches the backend from same-site pages such as
`auth.unhalteproblem.de`.

| Endpoint                                 | Role         | Does                                                      |
| ---------------------------------------- | ------------ | --------------------------------------------------------- |
| `GET /admin/users?limit&cursor`          | `admin`      | Lists users with all fields, roles and active restriction |
| `GET /admin/users/:id`                   | `admin`      | One user, with restriction history and role change log    |
| `POST /admin/users/:id/restriction`      | `admin`      | Restricts the account, with a note                        |
| `POST /admin/users/:id/restriction/lift` | `admin`      | Lifts the active restriction, with an optional note       |
| `PUT /admin/users/:id/roles/:role`       | `superAdmin` | Grants a role                                             |
| `DELETE /admin/users/:id/roles/:role`    | `superAdmin` | Revokes a role                                            |

The list is paged by keyset, oldest first (`created_at`, then `id`): the
response carries `nextCursor`, an opaque token for the position after the
last user, which the next request passes as `cursor` (400 if it is
malformed). It costs the same on every page, and users who register
meanwhile appear on later pages without shifting earlier ones. The cursor
holds the time in milliseconds, which is the precision `users.created_at` is
written with (from the Effect clock), so don't insert users by hand.

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
