# Account deletion

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
  deleted, and a failure is retried with backoff (see "Outbox" in [domains.md](domains.md)).

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
