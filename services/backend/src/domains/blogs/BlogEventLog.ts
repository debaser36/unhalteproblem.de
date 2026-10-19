import { Effect, Match, Schema } from "effect";
import * as DomainEvent from "#cqrs/DomainEvent";
import {
  BlogCreated,
  PostDeleted,
  PostPublished,
  PostSaved,
  PostUnpublished,
} from "./Blog.ts";

/** Logs the blogs domain's events: ids only, never post content. */
export const BlogEventLog = DomainEvent.subscriber(
  "BlogEventLog",
  Schema.Union([
    BlogCreated,
    PostSaved,
    PostPublished,
    PostUnpublished,
    PostDeleted,
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
    }),
);
