import { Authentication } from "#Authentication";
import {
  BlogRequest,
  BlogRequestId,
  BlogRequestLimits,
  CreateBlogRequestPayload,
} from "#domain/BlogRequest";
import { BlogRequestAlreadyPending } from "#errors/BlogRequestAlreadyPending";
import { BlogRequestNotFound } from "#errors/BlogRequestNotFound";
import { BlogRequestNotPending } from "#errors/BlogRequestNotPending";
import { SameOrigin } from "#SameOrigin";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";

/**
 * Success of `requestBlog`: the new `BlogRequest`, with status 201. A
 * one-member union that references the one `BlogRequest` component (see
 * `CreatedRestriction` in the admin group).
 */
const CreatedBlogRequest = Schema.Union([BlogRequest])
  .pipe(HttpApiSchema.status(201))
  .annotate({ description: "The new, pending blog request." });

/**
 * Self-service for subblog requests: any logged-in user may ask for their own
 * subblog and follow or withdraw their requests. Admins decide them in
 * `BlogRequestAdminGroup`.
 *
 * Every endpoint requires a session (`Authentication`, 401 `Unauthorized`);
 * the state-changing ones also require `SameOrigin` (403 `Forbidden` for a
 * foreign or missing `Origin`). No role is needed.
 */
export class BlogRequestsGroup extends HttpApiGroup.make("blogRequests")
  .add(
    HttpApiEndpoint.get("listMyBlogRequests", "/blog-requests", {
      success: Schema.Array(BlogRequest),
      error: [],
    }).annotateMerge(
      OpenApi.annotations({
        summary: "List the own blog requests",
        description:
          "Requires a session. Returns the caller's own blog requests of " +
          `every status, newest first, at most ${BlogRequestLimits.myListLimit}. ` +
          "A rejected request carries the admin's `reason`, an approved one " +
          "the `blog` slug of the created subblog.",
      }),
    ),
    HttpApiEndpoint.post("requestBlog", "/blog-requests", {
      payload: CreateBlogRequestPayload,
      success: CreatedBlogRequest,
      error: BlogRequestAlreadyPending,
    })
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Request a subblog",
          description:
            "Requires a session and a same-origin request. Asks for a " +
            "subblog with the given title and description; an admin " +
            "chooses the slug when approving. Answers 201 with the new " +
            "`pending` request, and 409 `BlogRequestAlreadyPending` if the " +
            "caller already has a pending one (at most one at a time).",
        }),
      ),
    HttpApiEndpoint.post(
      "withdrawBlogRequest",
      "/blog-requests/:requestId/withdraw",
      {
        params: { requestId: BlogRequestId },
        success: BlogRequest,
        error: [BlogRequestNotFound, BlogRequestNotPending],
      },
    )
      .middleware(SameOrigin)
      .annotateMerge(
        OpenApi.annotations({
          summary: "Withdraw a blog request",
          description:
            "Requires a session and a same-origin request. Withdraws the " +
            "caller's own pending request and answers with it (status " +
            "`withdrawn`). Answers 404 `BlogRequestNotFound` for an " +
            "unknown id or another user's request, and 409 " +
            "`BlogRequestNotPending` if it is already decided or withdrawn.",
        }),
      ),
  )
  // Protects every endpoint above; added after them, so it runs before
  // their own middlewares and answers 401 before any 403.
  .middleware(Authentication)
  .annotateMerge(
    OpenApi.annotations({
      title: "Blog requests",
      description:
        "Any logged-in user may request their own subblog by giving a " +
        "title and description, follow the decision and withdraw a pending " +
        "request.",
    }),
  ) {}
