# Client IP and rate limiting

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
