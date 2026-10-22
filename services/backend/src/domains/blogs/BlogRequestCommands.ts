import {
  Authorized,
  type BlogRequestReason,
  type CreateBlogRequestPayload,
  DefaultCategorySlug,
  Forbidden,
} from "@unhalteproblem.de/api";
import type { Subject } from "@unhalteproblem.de/oidc";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import * as Command from "#cqrs/Command";
import * as DomainEvent from "#cqrs/DomainEvent";
import { Transaction } from "#cqrs/Transaction";
import { AuditCommands } from "#domains/audit/AuditCommands";
import { ModerationCommands } from "#domains/moderation/ModerationCommands";
import type { UserId, UserNotFound } from "#domains/users/User";
import { actorIdOf, UserDirectory } from "#domains/users/UserDirectory";
import { isUniqueViolation } from "#infrastructure/Columns";
import {
  BlogCreated,
  BlogId,
  BlogRow,
  type BlogSlug,
  blogSlugConstraint,
  BlogSlugTaken,
} from "./Blog.ts";
import {
  BlogRequestAlreadyPending,
  BlogRequestApproved,
  BlogRequested,
  BlogRequestId,
  BlogRequestNotFound,
  BlogRequestNotPending,
  BlogRequestRejected,
  BlogRequestRow,
  BlogRequestWithdrawn,
  decide,
  onePendingConstraint,
} from "./BlogRequest.ts";
import {
  type AdminBlogRequestView,
  BlogRequestRepository,
} from "./BlogRequestRepository.ts";
import { BlogRepository } from "./BlogRepository.ts";
import { CategoryRepository } from "./CategoryRepository.ts";

/** The proof that the current user may decide blog requests. */
const moderator = () => Authorized("admin", "superAdmin");

const make = Effect.gen(function* () {
  const requests = yield* BlogRequestRepository;
  const blogs = yield* BlogRepository;
  const categories = yield* CategoryRepository;
  const users = yield* UserDirectory;
  const moderation = yield* ModerationCommands;
  const audit = yield* AuditCommands;
  const transaction = yield* Transaction;

  const actorOf = (proof: { readonly user: { readonly id: string } }) =>
    actorIdOf(proof).pipe(Effect.provideService(UserDirectory, users));

  /** Our id of the session's user. */
  const userOf = (subject: typeof Subject.Type) =>
    actorOf({ user: { id: subject } });

  /** The request, locked until the transaction ends; it must be pending. */
  const lockPending = Effect.fnUntraced(function* (requestId: BlogRequestId) {
    const request = yield* requests.lock(requestId);
    if (Option.isNone(request)) {
      return yield* new BlogRequestNotFound({ requestId });
    }
    if (request.value.status !== "pending") {
      return yield* new BlogRequestNotPending({
        requestId,
        status: request.value.status,
      });
    }
    return request.value;
  });

  /** The request of a moderator's decision: never their own. */
  const lockForModerator = Effect.fnUntraced(function* (
    requestId: BlogRequestId,
    actor: UserId,
  ) {
    const request = yield* lockPending(requestId);
    // Deciding one's own request would let an admin grant themselves an
    // editor role, which otherwise only superAdmins grant.
    if (request.requesterId === actor) return yield* new Forbidden();
    return request;
  });

  /** The request as it is now, after a change. */
  const viewOf = Effect.fnUntraced(function* (requestId: BlogRequestId) {
    const view = yield* requests.find(requestId);
    if (Option.isNone(view)) {
      return yield* Effect.die(
        new Error("Blog request vanished inside its transaction"),
      );
    }
    return view.value;
  });

  return BlogRequestCommands.of({
    request: Effect.fn("BlogRequestCommands.request")(function* (
      subject: typeof Subject.Type,
      payload: CreateBlogRequestPayload,
    ) {
      const requester = yield* userOf(subject);
      const id = BlogRequestId.make(crypto.randomUUID());
      // A second pending request fails the statement; inside a savepoint
      // that rolls back only the statement (see `BlogCommands`).
      yield* transaction
        .run(
          requests.insert(
            BlogRequestRow.make({
              id,
              requesterId: requester,
              title: payload.title,
              description: payload.description,
              status: "pending",
              createdAt: yield* DateTime.now,
              decidedAt: Option.none(),
              decidedBy: Option.none(),
              reason: Option.none(),
              blogId: Option.none(),
            }),
          ),
        )
        .pipe(
          Effect.catchIf(isUniqueViolation(onePendingConstraint), () =>
            Effect.fail(new BlogRequestAlreadyPending()),
          ),
        );
      yield* DomainEvent.record(
        new BlogRequested({ requestId: id, by: requester }),
      );
      return yield* viewOf(id);
    }, Command.boundary(transaction)),

    withdraw: Effect.fn("BlogRequestCommands.withdraw")(function* (
      subject: typeof Subject.Type,
      requestId: BlogRequestId,
    ) {
      const requester = yield* userOf(subject);
      const request = yield* requests.lock(requestId);
      // Someone else's request is none of the caller's business, not even
      // whether it exists.
      if (Option.isNone(request) || request.value.requesterId !== requester) {
        return yield* new BlogRequestNotFound({ requestId });
      }
      if (request.value.status !== "pending") {
        return yield* new BlogRequestNotPending({
          requestId,
          status: request.value.status,
        });
      }
      yield* requests.update(
        decide(
          request.value,
          { status: "withdrawn" },
          requester,
          yield* DateTime.now,
        ),
      );
      yield* DomainEvent.record(
        new BlogRequestWithdrawn({ requestId, by: requester }),
      );
      return yield* viewOf(requestId);
    }, Command.boundary(transaction)),

    approve: Effect.fn("BlogRequestCommands.approve")(function* (
      requestId: BlogRequestId,
      slug: BlogSlug,
    ) {
      const actor = yield* actorOf(yield* moderator());
      const request = yield* lockForModerator(requestId, actor);
      const now = yield* DateTime.now;
      const blogId = BlogId.make(crypto.randomUUID());
      // A new subblog starts in the default category; its editors choose
      // their own (`setBlogCategories`). The migration seeds it, but an admin
      // may have renamed, merged or deleted it since: then it is created
      // again (and locked against that until the approval commits).
      const { ids, created } = yield* categories.ensure(
        [{ slug: DefaultCategorySlug, name: "Miscellaneous" }],
        Option.some(actor),
        now,
      );
      const category = ids[0];
      if (category === undefined) {
        return yield* Effect.die(new Error("ensure returned no category"));
      }
      for (const slug of created) {
        yield* audit.record({
          action: "category_created",
          actor: Option.some(actor),
          target: Option.none(),
          detail: slug,
        });
      }
      yield* transaction
        .run(
          blogs.insertBlog(
            BlogRow.make({
              id: blogId,
              slug,
              title: request.title,
              description: request.description,
              mainCategoryId: category,
              createdAt: now,
              createdBy: Option.some(actor),
              updatedAt: now,
            }),
          ),
        )
        .pipe(
          Effect.catchIf(isUniqueViolation(blogSlugConstraint), () =>
            Effect.fail(new BlogSlugTaken({ blog: slug })),
          ),
        );
      // Refused (rolling the subblog back with it) if the requester has
      // deleted their account, or the moderator lost their roles meanwhile.
      yield* moderation.grantApprovedBlogEditor(request.requesterId, slug);
      yield* requests.update(
        decide(request, { status: "approved", blogId }, actor, now),
      );
      yield* DomainEvent.record(new BlogCreated({ blog: slug, by: actor }));
      yield* DomainEvent.record(
        new BlogRequestApproved({
          requestId,
          blog: slug,
          requester: request.requesterId,
          by: actor,
        }),
      );
      yield* audit.record({
        action: "blog_created",
        actor: Option.some(actor),
        target: Option.none(),
        detail: slug,
      });
      yield* audit.record({
        action: "blog_request_approved",
        actor: Option.some(actor),
        target: Option.some(request.requesterId),
        detail: slug,
      });
      return yield* viewOf(requestId);
    }, Command.boundary(transaction)),

    reject: Effect.fn("BlogRequestCommands.reject")(function* (
      requestId: BlogRequestId,
      reason: Option.Option<BlogRequestReason>,
    ) {
      const actor = yield* actorOf(yield* moderator());
      const request = yield* lockForModerator(requestId, actor);
      yield* requests.update(
        decide(
          request,
          { status: "rejected", reason },
          actor,
          yield* DateTime.now,
        ),
      );
      yield* DomainEvent.record(
        new BlogRequestRejected({
          requestId,
          requester: request.requesterId,
          by: actor,
        }),
      );
      // The reason stays out of the audit log, like restriction notes.
      yield* audit.record({
        action: "blog_request_rejected",
        actor: Option.some(actor),
        target: Option.some(request.requesterId),
      });
      return yield* viewOf(requestId);
    }, Command.boundary(transaction)),
  });
});

/** A moderator's proof: admins and superAdmins decide blog requests. */
type ModeratorProof = Authorized<"admin" | "superAdmin">;

/**
 * The commands of blog requests. Any logged-in user requests a subblog and
 * may withdraw their pending request (by their session's `sub`); admins and
 * superAdmins approve or reject requests, never their own (`Forbidden`).
 * Approving creates the subblog with the request's title and description
 * and grants the requester `blogEditor:<slug>`, in one transaction.
 */
export class BlogRequestCommands extends Context.Service<
  BlogRequestCommands,
  {
    /** Asks for a subblog; one pending request per user. */
    readonly request: (
      subject: typeof Subject.Type,
      payload: CreateBlogRequestPayload,
    ) => Effect.Effect<AdminBlogRequestView, BlogRequestAlreadyPending>;
    /** Withdraws the caller's own pending request. */
    readonly withdraw: (
      subject: typeof Subject.Type,
      requestId: BlogRequestId,
    ) => Effect.Effect<
      AdminBlogRequestView,
      BlogRequestNotFound | BlogRequestNotPending
    >;
    /** Creates the subblog `slug` and makes the requester its editor. */
    readonly approve: (
      requestId: BlogRequestId,
      slug: BlogSlug,
    ) => Effect.Effect<
      AdminBlogRequestView,
      | BlogRequestNotFound
      | BlogRequestNotPending
      | BlogSlugTaken
      | UserNotFound
      | Forbidden,
      ModeratorProof
    >;
    /** Rejects the request, with a reason the requester sees. */
    readonly reject: (
      requestId: BlogRequestId,
      reason: Option.Option<BlogRequestReason>,
    ) => Effect.Effect<
      AdminBlogRequestView,
      BlogRequestNotFound | BlogRequestNotPending | Forbidden,
      ModeratorProof
    >;
  }
>()("@unhalteproblem.de/backend/domains/blogs/BlogRequestCommands") {
  /** Needs `BlogRequestRepository`, `BlogRepository`, `CategoryRepository`, `UserDirectory`, `ModerationCommands`, `AuditCommands` and `Transaction`. */
  static readonly layer = Layer.effect(BlogRequestCommands, make);
}
