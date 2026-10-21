# Audit log

`audit_log` (domain `audit`, `AuditCommands.record`) remembers who did what
to whom, for the people who run the site. One row per action: when, which
action, the acting and the affected user (our ids), and a short qualifier
(the role of a role change).

| Action                                                  | Written                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `role_granted`, `role_revoked`                          | by the moderation command, in its transaction; only if it changed something     |
| `user_restricted`, `restriction_lifted`                 | by the moderation command, in its transaction                                   |
| `account_deleted`                                       | by `UserCommands.deleteAccount`, in its transaction                             |
| `login`                                                 | by the login callback, before the session is created (no entry, no session)     |
| `logout`, `login_refused`                               | by `POST /auth/logout` and the login callback; best effort, a failure is logged |
| `outbox_retried`                                        | by the admin insights commands, in their transaction; detail is the topic       |
| `contact_message_deleted`                               | by the admin insights commands, in their transaction; no detail                 |
| `blog_created`, `blog_updated`                          | by the blogs commands, in their transaction; detail is the blog slug            |
| `post_deleted`                                          | by the blogs commands, in their transaction; detail is the post id              |
| `project_created`, `project_updated`, `project_deleted` | by the projects commands, in their transaction; detail is the project slug      |

A row written inside a command exists exactly when the change does (it joins
the transaction), and a refused or no-op command leaves none. Not recorded:
logouts that Keycloak starts (back-channel), the registration of a user
with their first role, and publishing, unpublishing or saving posts (the
event log has them). The log holds ids only, never names, addresses,
restriction notes or IPs, because it is kept for `AUDIT_RETENTION` (a year by
default; a job deletes older rows once a day). Rows are never updated. Read
them with, for example,
`SELECT at, action, actor_id, target_id, detail FROM audit_log WHERE target_id = '…' ORDER BY id`.
