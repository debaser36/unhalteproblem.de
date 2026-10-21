# Authentication

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
- A second client for deleting accounts (see [account-deletion.md](account-deletion.md)): service
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
