import { Duration } from "effect";

/**
 * Holds the random id of an in-flight login between `GET /auth/login` and
 * `GET /auth/callback`, binding the callback to the browser that started
 * the login (login CSRF protection, RFC 9700 §2.1).
 */
export const LoginCookie = "__Host-login";

/** How long a login may take at Keycloak before it has to be restarted. */
export const LoginTimeout = Duration.minutes(10);

/**
 * Attributes of both auth cookies. `__Host-` names require `Secure`,
 * `Path=/` and no `Domain`. `SameSite=Lax` still sends them on the
 * top-level redirect back from Keycloak, but not on cross-site POSTs.
 */
export const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;
