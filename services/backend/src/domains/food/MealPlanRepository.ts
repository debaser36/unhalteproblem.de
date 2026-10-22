import {
  MealPlanDay,
  MealPlanFailureReason,
  MealPlanRequest,
  ShoppingListEntry,
} from "@unhalteproblem.de/api";
import {
  Context,
  type DateTime,
  Effect,
  Layer,
  type Option,
  Schema,
} from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { dieOnSchemaError } from "#infrastructure/Sql";

/** What `meal_plans.plan` holds once a plan is ready, in the contract's shapes. */
export const StoredPlan = Schema.Struct({
  days: Schema.Array(MealPlanDay),
  shoppingList: Schema.Array(ShoppingListEntry),
  notes: Schema.String,
});
export type StoredPlan = typeof StoredPlan.Type;

/** A row of `meal_plans`. jsonb comes back parsed. */
export const PlanRow = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  status: Schema.Literals(["pending", "ready", "failed"]),
  failureReason: Schema.NullOr(MealPlanFailureReason),
  cheapestTotal: Schema.NullOr(Schema.Number),
  country: Schema.Literals(["DE", "NZ"]),
  currency: Schema.Literals(["EUR", "NZD"]),
  request: MealPlanRequest,
  plan: Schema.NullOr(StoredPlan),
  totalCost: Schema.NullOr(Schema.Number),
  estimatedShare: Schema.NullOr(Schema.Number),
  accuracy: Schema.NullOr(Schema.Number),
  model: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromDate,
  finishedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
});
export type PlanRow = typeof PlanRow.Type;

const columns = `id, user_id, status, failure_reason,
  cheapest_total::float8 AS cheapest_total, country, currency, request, plan,
  total_cost::float8 AS total_cost, estimated_share, accuracy, model,
  created_at, finished_at`;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const select = sql.unsafe(columns);

  const insert = SqlSchema.void({
    Request: Schema.Struct({
      id: Schema.String,
      userId: Schema.String,
      country: Schema.String,
      currency: Schema.String,
      request: Schema.fromJsonString(MealPlanRequest),
      createdAt: Schema.DateTimeUtcFromDate,
    }),
    execute: (row) => sql`
      INSERT INTO meal_plans (id, user_id, status, country, currency, request, created_at)
      VALUES (${row.id}, ${row.userId}, 'pending', ${row.country}, ${row.currency},
              ${row.request}, ${row.createdAt})
    `,
  });

  const find = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: PlanRow,
    execute: (id) => sql`SELECT ${select} FROM meal_plans WHERE id = ${id}`,
  });

  const ownerMayPlan = SqlSchema.findOne({
    Request: Schema.String,
    Result: Schema.Struct({ allowed: Schema.Boolean }),
    execute: (id) => sql`
      SELECT EXISTS (
        SELECT 1 FROM meal_plans p
        JOIN users u ON u.id = p.user_id
        JOIN user_roles r ON r.user_id = u.id AND r.role = 'foodPlanner'
        WHERE p.id = ${id}
          AND u.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM user_restrictions x
            WHERE x.user_id = u.id AND x.lifted_at IS NULL
          )
      ) AS allowed
    `,
  });

  const findOf = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: Schema.String, userId: Schema.String }),
    Result: PlanRow,
    execute: ({ id, userId }) =>
      sql`SELECT ${select} FROM meal_plans WHERE id = ${id} AND user_id = ${userId}`,
  });

  const listOf = SqlSchema.findAll({
    Request: Schema.Struct({ userId: Schema.String, limit: Schema.Int }),
    Result: PlanRow,
    execute: ({ userId, limit }) => sql`
      SELECT ${select} FROM meal_plans WHERE user_id = ${userId}
      ORDER BY created_at DESC, id LIMIT ${limit}
    `,
  });

  const recent = SqlSchema.findOne({
    Request: Schema.Struct({
      userId: Schema.String,
      since: Schema.DateTimeUtcFromDate,
      pendingSince: Schema.DateTimeUtcFromDate,
    }),
    Result: Schema.Struct({ total: Schema.Number, pending: Schema.Number }),
    execute: ({ userId, since, pendingSince }) => sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (
               WHERE status = 'pending' AND created_at >= ${pendingSince}
             )::int AS pending
      FROM meal_plans WHERE user_id = ${userId} AND created_at >= ${since}
    `,
  });

  const complete = SqlSchema.findOneOption({
    Request: Schema.Struct({
      id: Schema.String,
      plan: Schema.fromJsonString(StoredPlan),
      totalCost: Schema.Number,
      estimatedShare: Schema.Int,
      accuracy: Schema.Int,
      model: Schema.String,
      now: Schema.DateTimeUtcFromDate,
    }),
    Result: Schema.Struct({ id: Schema.String }),
    execute: (row) => sql`
      UPDATE meal_plans SET status = 'ready', plan = ${row.plan},
        total_cost = ${row.totalCost}, estimated_share = ${row.estimatedShare},
        accuracy = ${row.accuracy}, model = ${row.model}, finished_at = ${row.now}
      WHERE id = ${row.id} AND status = 'pending'
      RETURNING id
    `,
  });

  const fail = SqlSchema.findOneOption({
    Request: Schema.Struct({
      id: Schema.String,
      reason: MealPlanFailureReason,
      cheapestTotal: Schema.NullOr(Schema.Number),
      now: Schema.DateTimeUtcFromDate,
    }),
    Result: Schema.Struct({ id: Schema.String }),
    execute: (row) => sql`
      UPDATE meal_plans SET status = 'failed', failure_reason = ${row.reason},
        cheapest_total = ${row.cheapestTotal}, finished_at = ${row.now}
      WHERE id = ${row.id} AND status = 'pending'
      RETURNING id
    `,
  });

  const remove = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: Schema.String, userId: Schema.String }),
    Result: Schema.Struct({ id: Schema.String }),
    execute: ({ id, userId }) =>
      sql`DELETE FROM meal_plans WHERE id = ${id} AND user_id = ${userId} RETURNING id`,
  });

  const removeOfDeletedUsers = SqlSchema.findOne({
    Request: Schema.Void,
    Result: Schema.Struct({ deleted: Schema.Number }),
    execute: () => sql`
      WITH deleted AS (
        DELETE FROM meal_plans p USING users u
        WHERE p.user_id = u.id AND u.deleted_at IS NOT NULL
        RETURNING 1
      )
      SELECT count(*)::int AS deleted FROM deleted
    `,
  });

  const span =
    (name: string) =>
    <A, R>(self: Effect.Effect<A, SqlError.SqlError | Schema.SchemaError, R>) =>
      self.pipe(
        dieOnSchemaError,
        Effect.withSpan(`MealPlanRepository.${name}`),
      );

  return MealPlanRepository.of({
    insert: (row) => insert(row).pipe(span("insert")),
    find: (id) => find(id).pipe(span("find")),
    ownerMayPlan: (id) =>
      ownerMayPlan(id).pipe(
        Effect.map(({ allowed }) => allowed),
        Effect.catchTag("NoSuchElementError", Effect.die),
        span("ownerMayPlan"),
      ),
    findOf: (id, userId) => findOf({ id, userId }).pipe(span("findOf")),
    listOf: (userId, limit) => listOf({ userId, limit }).pipe(span("listOf")),
    recent: (userId, since, pendingSince) =>
      recent({ userId, since, pendingSince }).pipe(
        // An aggregate always returns its one row.
        Effect.catchTag("NoSuchElementError", Effect.die),
        span("recent"),
      ),
    complete: (result) => complete(result).pipe(span("complete")),
    fail: (result) => fail(result).pipe(span("fail")),
    remove: (id, userId) => remove({ id, userId }).pipe(span("remove")),
    removeOfDeletedUsers: removeOfDeletedUsers(undefined).pipe(
      Effect.map(({ deleted }) => deleted),
      Effect.catchTag("NoSuchElementError", Effect.die),
      span("removeOfDeletedUsers"),
    ),
  });
});

/** Storage of meal plans (`meal_plans`). Used only inside the food domain. */
export class MealPlanRepository extends Context.Service<
  MealPlanRepository,
  {
    readonly insert: (row: {
      readonly id: string;
      readonly userId: string;
      readonly country: string;
      readonly currency: string;
      readonly request: MealPlanRequest;
      readonly createdAt: DateTime.Utc;
    }) => Effect.Effect<void, SqlError.SqlError>;
    readonly find: (
      id: string,
    ) => Effect.Effect<Option.Option<PlanRow>, SqlError.SqlError>;
    /**
     * Whether the plan's owner may still have it written: the account is
     * not deleted or restricted and still holds `foodPlanner`.
     */
    readonly ownerMayPlan: (
      id: string,
    ) => Effect.Effect<boolean, SqlError.SqlError>;
    /** The plan, if it belongs to the user. */
    readonly findOf: (
      id: string,
      userId: string,
    ) => Effect.Effect<Option.Option<PlanRow>, SqlError.SqlError>;
    /** The user's newest plans first. */
    readonly listOf: (
      userId: string,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<PlanRow>, SqlError.SqlError>;
    /**
     * How many plans the user asked for since `since`, and how many asked
     * for since `pendingSince` are still pending (older pending plans have
     * lost their job).
     */
    readonly recent: (
      userId: string,
      since: DateTime.Utc,
      pendingSince: DateTime.Utc,
    ) => Effect.Effect<
      { readonly total: number; readonly pending: number },
      SqlError.SqlError
    >;
    /** Stores the finished plan; `None` if it was not pending any more. */
    readonly complete: (result: {
      readonly id: string;
      readonly plan: StoredPlan;
      readonly totalCost: number;
      readonly estimatedShare: number;
      readonly accuracy: number;
      readonly model: string;
      readonly now: DateTime.Utc;
    }) => Effect.Effect<
      Option.Option<{ readonly id: string }>,
      SqlError.SqlError
    >;
    /** Marks the plan failed; `None` if it was not pending any more. */
    readonly fail: (result: {
      readonly id: string;
      readonly reason: MealPlanFailureReason;
      readonly cheapestTotal: number | null;
      readonly now: DateTime.Utc;
    }) => Effect.Effect<
      Option.Option<{ readonly id: string }>,
      SqlError.SqlError
    >;
    /** Deletes the plan if it belongs to the user; `None` if it doesn't. */
    readonly remove: (
      id: string,
      userId: string,
    ) => Effect.Effect<
      Option.Option<{ readonly id: string }>,
      SqlError.SqlError
    >;
    /** Deletes the plans of deleted accounts; how many. */
    readonly removeOfDeletedUsers: Effect.Effect<number, SqlError.SqlError>;
  }
>()("@unhalteproblem.de/backend/domains/food/MealPlanRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(MealPlanRepository, make);
}
