import { Effect, Match, Schema } from "effect";
import * as DomainEvent from "#cqrs/DomainEvent";
import {
  BlogCreated,
  PostDeleted,
  PostPublished,
  PostSaved,
  PostUnpublished,
} from "./Blog.ts";
import {
  BlogRequestApproved,
  BlogRequested,
  BlogRequestRejected,
  BlogRequestWithdrawn,
} from "./BlogRequest.ts";

/** Logs the blogs domain's events: ids only, never post or request content. */
export const BlogEventLog = DomainEvent.subscriber(
  "BlogEventLog",
  Schema.Union([
    BlogCreated,
    PostSaved,
    PostPublished,
    PostUnpublished,
    PostDeleted,
    BlogRequested,
    BlogRequestApproved,
    BlogRequestRejected,
    BlogRequestWithdrawn,
  ]),
  (event) =>
    Match.valueTags(event, {
      BlogCreated: ({ blog, by }) =>
        Effect.logInfo("Blog created").pipe(Effect.annotateLogs({ blog, by })),
      PostSaved: ({ blog, postId, version, by }) =>
        Effect.logInfo("Post saved").pipe(
          Effect.annotateLogs({ blog, postId, version, by }),
        ),
      PostPublished: ({ blog, postId, by }) =>
        Effect.logInfo("Post published").pipe(
          Effect.annotateLogs({ blog, postId, by }),
        ),
      PostUnpublished: ({ blog, postId, by }) =>
        Effect.logInfo("Post unpublished").pipe(
          Effect.annotateLogs({ blog, postId, by }),
        ),
      PostDeleted: ({ blog, postId, by }) =>
        Effect.logInfo("Post deleted").pipe(
          Effect.annotateLogs({ blog, postId, by }),
        ),
      BlogRequested: ({ requestId, by }) =>
        Effect.logInfo("Blog requested").pipe(
          Effect.annotateLogs({ requestId, by }),
        ),
      BlogRequestApproved: ({ requestId, blog, requester, by }) =>
        Effect.logInfo("Blog request approved").pipe(
          Effect.annotateLogs({ requestId, blog, requester, by }),
        ),
      BlogRequestRejected: ({ requestId, requester, by }) =>
        Effect.logInfo("Blog request rejected").pipe(
          Effect.annotateLogs({ requestId, requester, by }),
        ),
      BlogRequestWithdrawn: ({ requestId, by }) =>
        Effect.logInfo("Blog request withdrawn").pipe(
          Effect.annotateLogs({ requestId, by }),
        ),
    }),
);
