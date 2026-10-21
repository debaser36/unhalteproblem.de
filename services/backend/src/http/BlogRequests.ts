import {
  type AdminBlogRequest,
  Api,
  type BlogRequest,
  CurrentUser,
} from "@unhalteproblem.de/api";
import { Effect, Option } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { BlogRequestCommands } from "#domains/blogs/BlogRequestCommands";
import { BlogRequestQueries } from "#domains/blogs/BlogRequestQueries";
import type { AdminBlogRequestView } from "#domains/blogs/BlogRequestRepository";
import { noStore } from "./CacheControl.ts";

const toBlogRequest = ({
  request,
  blog,
}: AdminBlogRequestView): BlogRequest => ({
  id: request.id,
  title: request.title,
  description: request.description,
  status: request.status,
  createdAt: request.createdAt,
  decidedAt: Option.getOrNull(request.decidedAt),
  reason: Option.getOrNull(request.reason),
  blog: Option.getOrNull(blog),
});

const toAdminBlogRequest = (view: AdminBlogRequestView): AdminBlogRequest => ({
  ...toBlogRequest(view),
  requester: {
    id: view.request.requesterId,
    username: Option.getOrNull(view.requester.username),
    name: Option.getOrNull(view.requester.name),
    deleted: view.requester.deleted,
  },
  decidedBy: Option.getOrNull(view.request.decidedBy),
});

/**
 * The caller's own blog requests. `Authentication` made `CurrentUser` from
 * the cookie, so every command acts on the caller's own requests only.
 */
export const BlogRequestsHandlers = HttpApiBuilder.group(
  Api,
  "blogRequests",
  Effect.fn(function* (handlers) {
    const commands = yield* BlogRequestCommands;
    const queries = yield* BlogRequestQueries;
    const subject = Effect.map(
      Effect.service(CurrentUser),
      ({ user }) => user.id,
    );
    return handlers
      .handle("listMyBlogRequests", () =>
        subject.pipe(
          Effect.flatMap(queries.mine),
          Effect.map((views) => views.map(toBlogRequest)),
          noStore,
        ),
      )
      .handle("requestBlog", ({ payload }) =>
        subject.pipe(
          Effect.flatMap((user) => commands.request(user, payload)),
          Effect.map(toBlogRequest),
          noStore,
        ),
      )
      .handle("withdrawBlogRequest", ({ params }) =>
        subject.pipe(
          Effect.flatMap((user) => commands.withdraw(user, params.requestId)),
          Effect.map(toBlogRequest),
          noStore,
        ),
      );
  }),
);

/**
 * Deciding blog requests. Each endpoint's `RequireBlogRequestModerator`
 * provides the proof the commands and queries require.
 */
export const BlogRequestAdminHandlers = HttpApiBuilder.group(
  Api,
  "blogRequestAdmin",
  Effect.fn(function* (handlers) {
    const commands = yield* BlogRequestCommands;
    const queries = yield* BlogRequestQueries;
    return handlers
      .handle("listBlogRequests", ({ query }) =>
        queries
          .list({
            status: Option.fromUndefinedOr(query.status),
            limit: query.limit,
          })
          .pipe(
            Effect.map((views) => views.map(toAdminBlogRequest)),
            noStore,
          ),
      )
      .handle("approveBlogRequest", ({ params, payload }) =>
        commands
          .approve(params.requestId, payload.slug)
          .pipe(Effect.map(toAdminBlogRequest), noStore),
      )
      .handle("rejectBlogRequest", ({ params, payload }) =>
        commands
          .reject(params.requestId, Option.fromNullishOr(payload.reason))
          .pipe(Effect.map(toAdminBlogRequest), noStore),
      );
  }),
);
