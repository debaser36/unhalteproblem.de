import { Authentication } from "#Authentication";
import { RequireRoles } from "#Authorization";
import {
  AdminBlogRequest,
  AdminBlogRequestQuery,
  ApproveBlogRequestPayload,
  BlogRequestId,
  RejectBlogRequestPayload,
} from "#domain/BlogRequest";
import { BlogRequestNotFound } from "#errors/BlogRequestNotFound";
import { BlogRequestNotPending } from "#errors/BlogRequestNotPending";
import { BlogSlugTaken } from "#errors/BlogSlugTaken";
import { UserNotFound } from "#errors/UserNotFound";
import { SameOrigin } from "#SameOrigin";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";

/**
 * Requires `admin` or `superAdmin` (any of them): deciding blog requests.
 * Unlike `RequireAdmin`, a superAdmin does not also need `admin`.
 */
export const RequireBlogRequestModerator = RequireRoles("admin", "superAdmin");

/** Path parameters of the endpoints for one blog request. */
const RequestParams = { requestId: BlogRequestId };

/**
 * Moderation of blog requests: admins and superAdmins list them, approve
 * them (creating the subblog) and reject them.
 *
 * Every endpoint requires a session (`Authentication`, 401) and one of the
 * roles (`RequireBlogRequestModerator`, 403 `Forbidden`). The state-changing
 * ones also require `SameOrigin`. Middleware order as in `AdminGroup`: the
 * group's `Authentication` runs first, and on an endpoint `SameOrigin` is
 * added after the role middleware, so the origin is checked before the
 * roles.
 */
export class BlogRequestAdminGroup extends HttpApiGroup.make("blogRequestAdmin")
  .add(
    HttpApiEndpoint.get("listBlogRequests", "/admin/blog-requests", {
      query: AdminBlogRequestQuery,
      success: Schema.Array(AdminBlogRequest),
      // An invalid `status` or `limit` is rejected by schema validation
      // (400). 401 and 403 come from the middlewares.
      error: [],
    })
      .middleware(RequireBlogRequestModerator)
      .annotateMerge(
        OpenApi.annotations({
          summary: "List blog requests",
          description:
            "Requires `admin` or `superAdmin`. Returns the blog requests " +
            "of all users with their requester, newest first (by " +
            "`createdAt`, then `id`), optionally only those in one " +
            "`status`. There is no cursor: `limit` is 1 to 200 (default " +
            "50).",
        }),
      ),
    HttpApiEndpoint.post(
      "approveBlogRequest",
      "/admin/blog-requests/:requestId/approve",
      {
        params: RequestParams,
        payload: ApproveBlogRequestPayload,
        success: AdminBlogRequest,
        error: [
          BlogRequestNotFound,
          BlogRequestNotPending,
          BlogSlugTaken,
          UserNotFound,
        ],
      },
    )
      .middleware(RequireBlogRequestModerator)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Approve a blog request",
          description:
            "Requires `admin` or `superAdmin` and a same-origin request. " +
            "Creates the subblog with the request's title and description " +
            "and the given slug (immutable: it is part of the URLs and of " +
            "the role `blogEditor:<slug>`) and grants the requester " +
            "`blogEditor:<slug>`, in one step. Unlike `grantRole` " +
            "(`superAdmin` only), an admin may do this: the approval " +
            "grants exactly this one role, the editor role of the new " +
            "subblog. Answers 200 with the approved request. Answers 404 " +
            "`BlogRequestNotFound` for an unknown id, 409 " +
            "`BlogRequestNotPending` if it is already decided or " +
            "withdrawn, 409 `BlogSlugTaken` if a subblog with the slug " +
            "exists, and 404 `UserNotFound` if the requester has deleted " +
            "their account.",
        }),
      ),
    HttpApiEndpoint.post(
      "rejectBlogRequest",
      "/admin/blog-requests/:requestId/reject",
      {
        params: RequestParams,
        payload: RejectBlogRequestPayload,
        success: AdminBlogRequest,
        error: [BlogRequestNotFound, BlogRequestNotPending],
      },
    )
      .middleware(RequireBlogRequestModerator)
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Reject a blog request",
          description:
            "Requires `admin` or `superAdmin` and a same-origin request. " +
            "Rejects a pending request, with an optional reason that the " +
            "requester sees. Creates no subblog and grants no role. " +
            "Answers 200 with the rejected request, 404 " +
            "`BlogRequestNotFound` for an unknown id, and 409 " +
            "`BlogRequestNotPending` if it is already decided or " +
            "withdrawn.",
        }),
      ),
  )
  // Protects every endpoint above; added after them, so it runs before
  // their role middlewares and answers 401 before any 403.
  .middleware(Authentication)
  .annotateMerge(
    OpenApi.annotations({
      title: "Blog request administration",
      description:
        "Admins and superAdmins list, approve and reject requests for " +
        "subblogs. Approval creates the subblog and makes the requester " +
        "its editor.",
    }),
  ) {}
