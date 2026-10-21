# Administration

The `admin` group of the contract, under `/admin`. Every endpoint needs a
session (401) and a role (403); the state-changing ones also need the
website's `Origin` (`SameOrigin`, 403 otherwise), because the SameSite=Lax
session cookie still reaches the backend from same-site pages such as
`auth.unhalteproblem.de`.

| Endpoint                                      | Role         | Does                                                      |
| --------------------------------------------- | ------------ | --------------------------------------------------------- |
| `GET /admin/users?limit&cursor`               | `admin`      | Lists users with all fields, roles and active restriction |
| `GET /admin/users/:id`                        | `admin`      | One user, with restriction history and role change log    |
| `POST /admin/users/:id/restriction`           | `admin`      | Restricts the account, with a note                        |
| `POST /admin/users/:id/restriction/lift`      | `admin`      | Lifts the active restriction, with an optional note       |
| `PUT /admin/users/:id/roles/:role`            | `superAdmin` | Grants a role                                             |
| `DELETE /admin/users/:id/roles/:role`         | `superAdmin` | Revokes a role                                            |
| `GET /admin/database`                         | `admin`      | Postgres version, size, connections, tables, migrations   |
| `GET /admin/outbox?state&limit`               | `admin`      | Outbox messages, newest first, without payloads           |
| `POST /admin/outbox/:id/retry`                | `admin`      | Makes a message due now with fresh attempts (audited)     |
| `GET /admin/audit?limit&cursor&action&userId` | `admin`      | The audit log, newest first                               |
| `GET /admin/contact?limit&cursor`             | `admin`      | Stored contact messages, newest first                     |
| `DELETE /admin/contact/:id`                   | `admin`      | Deletes a contact message, e.g. spam (audited)            |

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
