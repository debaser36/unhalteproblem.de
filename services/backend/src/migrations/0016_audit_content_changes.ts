import { Effect } from "effect";
import { SqlClient } from "effect/sql";

/**
 * Audit actions of content changes, written by the blogs and projects
 * commands in their transaction:
 *
 * - `blog_created`, `blog_updated`: an editor created or changed a subblog.
 *   detail is the blog's slug.
 * - `post_deleted`: an editor deleted a post. detail is the post's id.
 * - `project_created`, `project_updated`, `project_deleted`: an admin
 *   created, changed or deleted a project. detail is the project's slug.
 *
 * Publishing, unpublishing and saving posts are not audited: the event log
 * has them.
 *
 * This replaces audit_log_action_check (0015) under the same name, the same
 * way 0015 did; see there for why it is one statement and validated right
 * away. Adding an action still means a new migration that replaces it again.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Only widens the old check, so every existing row satisfies it.
  yield* sql`
    ALTER TABLE audit_log
      DROP CONSTRAINT audit_log_action_check,
      ADD CONSTRAINT audit_log_action_check
        CHECK (
          action IN (
            'login',
            'logout',
            'login_refused',
            'role_granted',
            'role_revoked',
            'user_restricted',
            'restriction_lifted',
            'account_deleted',
            'outbox_retried',
            'contact_message_deleted',
            'blog_created',
            'blog_updated',
            'post_deleted',
            'project_created',
            'project_updated',
            'project_deleted'
          )
        )
  `;
});
