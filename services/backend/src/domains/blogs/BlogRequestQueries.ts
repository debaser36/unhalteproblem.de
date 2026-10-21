import { Authorized, BlogRequestLimits } from "@unhalteproblem.de/api";
import type { Subject } from "@unhalteproblem.de/oidc";
import { Context, Effect, Layer, Option } from "effect";
import * as Query from "#cqrs/Query";
import { UserDirectory } from "#domains/users/UserDirectory";
import type { BlogRequestStatus } from "./BlogRequest.ts";
import {
  type AdminBlogRequestView,
  BlogRequestRepository,
} from "./BlogRequestRepository.ts";

const make = Effect.gen(function* () {
  const repository = yield* BlogRequestRepository;
  const users = yield* UserDirectory;

  return BlogRequestQueries.of({
    mine: Effect.fn("BlogRequestQueries.mine")(function* (
      subject: typeof Subject.Type,
    ) {
      const user = yield* users.findBySubject(subject);
      if (Option.isNone(user)) return [];
      return yield* repository.listOfRequester(
        user.value.id,
        BlogRequestLimits.myListLimit,
      );
    }, Query.boundary),

    list: Effect.fn("BlogRequestQueries.list")(function* (query: {
      readonly status: Option.Option<BlogRequestStatus>;
      readonly limit: number;
    }) {
      yield* Authorized("admin", "superAdmin");
      return yield* repository.list(query);
    }, Query.boundary),
  });
});

/**
 * Reading blog requests: the caller's own (by their session's `sub`), and
 * all of them for admins and superAdmins.
 *
 * @effect-expect-leaking Authorized<"admin" | "superAdmin">
 */
export class BlogRequestQueries extends Context.Service<
  BlogRequestQueries,
  {
    /** The user's own requests, newest first (the latest 50). */
    readonly mine: (
      subject: typeof Subject.Type,
    ) => Effect.Effect<ReadonlyArray<AdminBlogRequestView>>;
    /** Requests with `status` or any, newest first. */
    readonly list: (query: {
      readonly status: Option.Option<BlogRequestStatus>;
      readonly limit: number;
    }) => Effect.Effect<
      ReadonlyArray<AdminBlogRequestView>,
      never,
      Authorized<"admin" | "superAdmin">
    >;
  }
>()("@unhalteproblem.de/backend/domains/blogs/BlogRequestQueries") {
  /** Needs `BlogRequestRepository` and `UserDirectory`. */
  static readonly layer = Layer.effect(BlogRequestQueries, make);
}
