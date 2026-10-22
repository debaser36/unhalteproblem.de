import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, type SqlError, SqlModel } from "effect/sql";
import type { UserId } from "#domains/users/User";
import { dieOnSchemaError } from "#infrastructure/Sql";
import { BlogSlug } from "./Blog.ts";
import {
  type BlogRequestId,
  BlogRequestRow,
  type BlogRequestStatus,
} from "./BlogRequest.ts";

/** A request with the slug of the subblog its approval created. */
export interface BlogRequestView {
  readonly request: BlogRequestRow;
  /** None until approved (and if the subblog is gone). */
  readonly blog: Option.Option<BlogSlug>;
}

/** A request as moderators see it: with who asked. */
export interface AdminBlogRequestView extends BlogRequestView {
  readonly requester: {
    readonly username: Option.Option<string>;
    readonly name: Option.Option<string>;
    /** Whether the requester has deleted their account. */
    readonly deleted: boolean;
  };
}

const Extras = Schema.Struct({
  blogSlug: Schema.NullOr(BlogSlug),
  requesterUsername: Schema.NullOr(Schema.String),
  requesterName: Schema.NullOr(Schema.String),
  requesterDeleted: Schema.Boolean,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const requests = yield* SqlModel.makeRepository(BlogRequestRow, {
    tableName: "blog_requests",
    spanPrefix: "BlogRequestRepository",
    idColumn: "id",
  });

  const select = sql`
    SELECT r.*,
           b.slug AS blog_slug,
           u.username AS requester_username,
           u.name AS requester_name,
           u.deleted_at IS NOT NULL AS requester_deleted
    FROM blog_requests r
    JOIN users u ON u.id = r.requester_id
    LEFT JOIN blogs b ON b.id = r.blog_id
  `;

  const decodeRows = Schema.decodeUnknownEffect(Schema.Array(BlogRequestRow));
  const decodeExtras = Schema.decodeUnknownEffect(Schema.Array(Extras));
  const toViews = (rows: ReadonlyArray<unknown>) =>
    Effect.zipWith(decodeRows(rows), decodeExtras(rows), (requests, extras) =>
      requests.map((request, index): AdminBlogRequestView => ({
        request,
        blog: Option.fromNullOr(extras[index]!.blogSlug),
        requester: {
          username: Option.fromNullOr(extras[index]!.requesterUsername),
          name: Option.fromNullOr(extras[index]!.requesterName),
          deleted: extras[index]!.requesterDeleted,
        },
      })),
    );

  return BlogRequestRepository.of({
    insert: (request) =>
      requests
        .insertVoid(BlogRequestRow.insert.make(request))
        .pipe(dieOnSchemaError),

    update: (request) =>
      requests
        .updateVoid(BlogRequestRow.update.make(request))
        .pipe(dieOnSchemaError),

    lock: (id) =>
      sql`SELECT * FROM blog_requests WHERE id = ${id} FOR NO KEY UPDATE`.pipe(
        Effect.flatMap(decodeRows),
        Effect.map((rows) => Option.fromUndefinedOr(rows[0])),
        dieOnSchemaError,
        Effect.withSpan("BlogRequestRepository.lock"),
      ),

    find: (id) =>
      sql`${select} WHERE r.id = ${id}`.pipe(
        Effect.flatMap(toViews),
        Effect.map((views) => Option.fromUndefinedOr(views[0])),
        dieOnSchemaError,
        Effect.withSpan("BlogRequestRepository.find"),
      ),

    listOfRequester: (requesterId, limit) =>
      sql`
        ${select}
        WHERE r.requester_id = ${requesterId}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${limit}
      `.pipe(
        Effect.flatMap(toViews),
        dieOnSchemaError,
        Effect.withSpan("BlogRequestRepository.listOfRequester"),
      ),

    list: ({ status, limit }) =>
      sql`
        ${select}
        ${Option.isSome(status) ? sql`WHERE r.status = ${status.value}` : sql``}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${limit}
      `.pipe(
        Effect.flatMap(toViews),
        dieOnSchemaError,
        Effect.withSpan("BlogRequestRepository.list"),
      ),
  });
});

/** Storage of blog requests (`blog_requests`). Used only inside the blogs domain. */
export class BlogRequestRepository extends Context.Service<
  BlogRequestRepository,
  {
    /** Fails with a `UniqueViolation` if the requester has a pending one; run it in a savepoint. */
    readonly insert: (
      request: BlogRequestRow,
    ) => Effect.Effect<void, SqlError.SqlError>;
    readonly update: (
      request: BlogRequestRow,
    ) => Effect.Effect<void, SqlError.SqlError>;
    /** The request, locked until the transaction ends. */
    readonly lock: (
      id: BlogRequestId,
    ) => Effect.Effect<Option.Option<BlogRequestRow>, SqlError.SqlError>;
    readonly find: (
      id: BlogRequestId,
    ) => Effect.Effect<Option.Option<AdminBlogRequestView>, SqlError.SqlError>;
    /** Up to `limit` requests of one user, newest first. */
    readonly listOfRequester: (
      requesterId: UserId,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<AdminBlogRequestView>, SqlError.SqlError>;
    /** Up to `limit` requests, with `status` or any, newest first. */
    readonly list: (query: {
      readonly status: Option.Option<BlogRequestStatus>;
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<AdminBlogRequestView>, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/blogs/BlogRequestRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(BlogRequestRepository, make);
}
