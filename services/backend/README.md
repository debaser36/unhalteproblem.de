# @unhalteproblem.de/backend

The backend of unhalteproblem.de. It implements the HTTP contract from
[`@unhalteproblem.de/api`](../../lib/api): `GET /health`, `POST /contact` and
the browser login under `/auth/*`. `GET /health` says the process is up;
`GET /ready` also runs `SELECT 1` (2 second timeout) and answers 503 without a
body when the database does not answer. The container image probes `/ready`
every 30 seconds as its healthcheck.
Contact messages are stored in Postgres and mailed to the owner (see [docs/contact.md](docs/contact.md)).

## Running

- `pnpm --filter @unhalteproblem.de/backend dev` runs `src/main.ts` from source with `node --watch`.
- `pnpm --filter @unhalteproblem.de/backend build` bundles it into `dist/main.js`, and `start` runs that bundle.
- `nix build .#backend-image` builds the container image, and `nixosModules.backend` runs it on a NixOS server (see the root `flake.nix` and `nix/backend-module.nix`).

## Environment

| Variable                       | Default                                                     | Meaning                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                         | `3000`                                                      | Port to listen on                                                                                                                                                           |
| `HOST`                         | `127.0.0.1`                                                 | Interface to bind; the container sets `0.0.0.0`                                                                                                                             |
| `LOG_FORMAT`                   | `pretty`                                                    | `pretty` or `json`; the container sets `json`                                                                                                                               |
| `LOG_LEVEL`                    | `Info`                                                      | Least severe level that is logged: `Debug`, `Info`, `Warn` or `Error`; `Debug` adds `/health` and `/ready` requests                                                         |
| `CONTACT_RATE_LIMIT`           | `5`                                                         | Contact messages per client and window (must be > 0)                                                                                                                        |
| `CONTACT_RATE_LIMIT_GLOBAL`    | `100`                                                       | Contact messages from all clients together per window (must be > 0)                                                                                                         |
| `CONTACT_RATE_LIMIT_WINDOW`    | `1 hour`                                                    | Length of that window as an Effect duration, e.g. `10 minutes` (must be > 0)                                                                                                |
| `LOGIN_RATE_LIMIT`             | `30`                                                        | Login starts per client and window (must be > 0)                                                                                                                            |
| `LOGIN_RATE_LIMIT_GLOBAL`      | `3000`                                                      | Login starts from all clients together per window (must be > 0)                                                                                                             |
| `LOGIN_RATE_LIMIT_WINDOW`      | `10 minutes`                                                | Length of that window as an Effect duration (must be > 0)                                                                                                                   |
| `POSTGRES_HOST`                | `localhost`                                                 | Postgres host                                                                                                                                                               |
| `POSTGRES_PORT`                | `5432`                                                      | Postgres port                                                                                                                                                               |
| `POSTGRES_DB`                  | `unhalteproblem`                                            | Database name (must exist)                                                                                                                                                  |
| `POSTGRES_USER`                | `unhalteproblem`                                            | Database user                                                                                                                                                               |
| `POSTGRES_PASSWORD`            | unset                                                       | Database password; set it through an environment file, never in the Nix store                                                                                               |
| `POSTGRES_MAX_CONNECTIONS`     | `10`                                                        | Size of the connection pool (must be > 0)                                                                                                                                   |
| `POSTGRES_CONNECT_TIMEOUT`     | `5 seconds`                                                 | How long opening a connection may take, as an Effect duration (must be > 0)                                                                                                 |
| `POSTGRES_STATEMENT_TIMEOUT`   | `30 seconds`                                                | Postgres cancels any statement that runs longer, migrations included (must be > 0)                                                                                          |
| `OIDC_ISSUER`                  | `https://auth.unhalteproblem.de/realms/unhalteproblem-main` | Keycloak realm URL, exactly as Keycloak reports it as `issuer`                                                                                                              |
| `OIDC_CLIENT_ID`               | `unhalteproblem-backend`                                    | This backend's client id in that realm                                                                                                                                      |
| `OIDC_CLIENT_SECRET`           | required                                                    | The client's secret; set it through an environment file, never in the Nix store                                                                                             |
| `KEYCLOAK_ADMIN_CLIENT_ID`     | `unhalteproblem-backend-admin`                              | The Keycloak client that deletes users (a different one than `OIDC_CLIENT_ID`)                                                                                              |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | required                                                    | Its secret; set it through an environment file, never in the Nix store                                                                                                      |
| `PUBLIC_ORIGIN`                | `https://unhalteproblem.de`                                 | Origin of the website: login return target, post-logout target, allowed `Origin` of `POST /auth/logout`                                                                     |
| `PUBLIC_API_URL`               | `<PUBLIC_ORIGIN>/api`                                       | Public URL of this backend; the login callback is `<PUBLIC_API_URL>/auth/callback`                                                                                          |
| `SESSION_MAX_AGE`              | `8 hours`                                                   | How long a login lasts, as an Effect duration (must be > 0)                                                                                                                 |
| `CONTACT_RETENTION`            | `90 days`                                                   | How long contact messages are kept before they are deleted (must be > 0)                                                                                                    |
| `AUDIT_RETENTION`              | `365 days`                                                  | How long audit log entries are kept before they are deleted (must be > 0)                                                                                                   |
| `SMTP_HOST`                    | unset                                                       | SMTP server for the mails about contact messages. Unset: messages are stored but not mailed                                                                                 |
| `SMTP_PORT`                    | `587` (`465` with `tls`)                                    | SMTP port                                                                                                                                                                   |
| `SMTP_SECURITY`                | `starttls`                                                  | `starttls`, `tls`, or `none` (plain text, only accepted for `localhost`, e.g. Mailpit)                                                                                      |
| `SMTP_USER`                    | unset                                                       | SMTP login; then `SMTP_PASSWORD` is required (set it through an environment file)                                                                                           |
| `SMTP_FROM`                    | required with `SMTP_HOST`                                   | Sender of the mails, e.g. `Website <noreply@unhalteproblem.de>`                                                                                                             |
| `CONTACT_MAIL_TO`              | required with `SMTP_HOST`                                   | Who gets the mails about contact messages                                                                                                                                   |
| `ANTHROPIC_API_KEY`            | unset                                                       | Claude API key for the food planner's meal plans and price estimates. Unset: creating a meal plan answers 503; set it through an environment file                           |
| `CLAUDE_MODEL`                 | `claude-opus-5-5`                                           | Model for meal plans and price estimates                                                                                                                                    |
| `CLAUDE_EFFORT`                | `medium`                                                    | `low`, `medium`, `high`, `xhigh` or `max`: thoroughness against cost and time per request                                                                                   |
| `STRIPE_SECRET_KEY`            | unset                                                       | Stripe secret key (`sk_test_…` for the sandbox, `sk_live_…`). Unset (or no webhook secret): the catalog is empty and paying answers 503; set it through an environment file |
| `STRIPE_WEBHOOK_SECRET`        | unset                                                       | Signing secret of the Stripe webhook endpoint (`whsec_…`); set it through an environment file                                                                               |
| `STRIPE_AUTOMATIC_TAX`         | `false`                                                     | Let Stripe Tax compute VAT in Checkout (off for a Kleinunternehmer; needs Stripe Tax set up)                                                                                |
| `STRIPE_CHECKOUT_INVOICES`     | `false`                                                     | Have Checkout create invoices for one-off payments (Stripe charges for them)                                                                                                |
| `STRIPE_INVOICE_FOOTER`        | unset                                                       | Footer of those invoices, e.g. the §19 UStG note                                                                                                                            |
| `TIP_CURRENCY`                 | `eur`                                                       | Currency of custom tips                                                                                                                                                     |
| `TIP_MINIMUM`, `TIP_MAXIMUM`   | `100`, `50000`                                              | Bounds of a custom tip in the currency's minor unit (cents)                                                                                                                 |

Invalid values stop the service at startup instead of being ignored.

Every connection also gets `idle_in_transaction_session_timeout = 60s`, so a
transaction that is left open releases its locks and its pooled connection.

## Topics

Each topic lives in its own file under `docs/`; read only the one you need.

| File                                                 | Covers                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| [docs/domains.md](docs/domains.md)                   | Domain/CQRS kernel, outbox, users, moderation (copy `users` for a new domain) |
| [docs/authorization.md](docs/authorization.md)       | Roles, `Authorized(...)` proofs, `RequireRoles`                               |
| [docs/authentication.md](docs/authentication.md)     | OIDC browser login, sessions, back-channel logout, Keycloak setup             |
| [docs/account-deletion.md](docs/account-deletion.md) | Deleting accounts, Keycloak cleanup                                           |
| [docs/database.md](docs/database.md)                 | Postgres, migrations (long-running ones), backups                             |
| [docs/administration.md](docs/administration.md)     | The `admin` API group and admin insights                                      |
| [docs/audit-log.md](docs/audit-log.md)               | Audit log                                                                     |
| [docs/blogs.md](docs/blogs.md)                       | Subblogs and posts                                                            |
| [docs/projects.md](docs/projects.md)                 | Projects                                                                      |
| [docs/media.md](docs/media.md)                       | Image upload and serving                                                      |
| [docs/seo.md](docs/seo.md)                           | Crawler pages, sitemap, nginx routing                                         |
| [docs/contact.md](docs/contact.md)                   | Contact form and mail                                                         |
| [docs/food.md](docs/food.md)                         | Food planner: open food data, prices, imports, AI meal plans                  |
| [docs/payments.md](docs/payments.md)                 | Stripe payments: checkout, webhooks, paid roles, credits, setup               |
| [docs/rate-limiting.md](docs/rate-limiting.md)       | Client IP and rate limiting                                                   |
| [docs/logging.md](docs/logging.md)                   | Request ids and request logging                                               |
