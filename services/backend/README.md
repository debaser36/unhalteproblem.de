# @unhalteproblem.de/backend

The backend of unhalteproblem.de. It implements the HTTP contract from
[`@unhalteproblem.de/api`](../../lib/api): `GET /health` and `POST /contact`.
Contact messages are only logged for now.

## Running

- `pnpm --filter @unhalteproblem.de/backend dev` runs `src/main.ts` from source with `node --watch`.
- `pnpm --filter @unhalteproblem.de/backend build` bundles it into `dist/main.js`, and `start` runs that bundle.
- `nix build .#backend-image` builds the container image, and `nixosModules.backend` runs it on a NixOS server (see the root `flake.nix` and `nix/backend-module.nix`).

## Environment

| Variable                    | Default     | Meaning                                                                      |
| --------------------------- | ----------- | ---------------------------------------------------------------------------- |
| `PORT`                      | `3000`      | Port to listen on                                                            |
| `HOST`                      | `127.0.0.1` | Interface to bind; the container sets `0.0.0.0`                              |
| `LOG_FORMAT`                | `pretty`    | `pretty` or `json`; the container sets `json`                                |
| `CONTACT_RATE_LIMIT`        | `5`         | Contact messages per client and window (must be > 0)                         |
| `CONTACT_RATE_LIMIT_GLOBAL` | `100`       | Contact messages from all clients together per window (must be > 0)          |
| `CONTACT_RATE_LIMIT_WINDOW` | `1 hour`    | Length of that window as an Effect duration, e.g. `10 minutes` (must be > 0) |

Invalid values stop the service at startup instead of being ignored.

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
