# Logging

Every request gets an id: `X-Request-Id` from nginx (which sets it to its own
`$request_id`) when it looks like one, else a fresh UUID. It is returned as
`X-Request-Id` and annotates every log line written while the request runs, so
one request can be followed through the log and matched to nginx's access log.
When a request ends, `RequestLogging` logs `Sent HTTP response` with method,
path, status, duration and the client's rate-limit key (see [Client IP and rate limiting](rate-limiting.md)). The query is
never logged, since it holds OIDC codes and state. `/health` and `/ready` are
logged at debug level, 5xx responses at error level with their cause.
