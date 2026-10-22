# Authorization

Users have roles: `normalUser`, `admin`, `superAdmin` and `foodPlanner`
(uses the food planner, see [food.md](food.md); since migration 0019)
(`Role` in `@unhalteproblem.de/api`), and `blogEditor:<slug>`, which lets its holder
edit the posts of the subblog `<slug>` (lowercase letters and digits in
groups joined by hyphens, at most 64 characters). superAdmins grant and
revoke it through the admin API like any other role; an admin or superAdmin
approving a user's blog request also grants it to them for the new subblog
(see [blogs.md](blogs.md)). Roles are flat, so no
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

Roles are managed through the admin API (see [administration.md](administration.md)). Only the
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
