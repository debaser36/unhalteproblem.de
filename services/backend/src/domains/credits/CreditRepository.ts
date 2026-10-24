import { CreditFeature, PaymentId } from "@unhalteproblem.de/api";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import { UserId } from "#domains/users/User";
import { dieOnSchemaError } from "#infrastructure/Sql";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const paymentsWithCredits = SqlSchema.findAll({
    Request: Schema.Struct({ paymentIds: Schema.Array(Schema.String) }),
    Result: Schema.Struct({ paymentId: PaymentId }),
    execute: ({ paymentIds }) => sql`
      SELECT DISTINCT payment_id FROM feature_credits
      WHERE ${sql.in("payment_id", paymentIds)}
    `,
  });

  // The oldest credit first, so that the one bought first is used first.
  // SKIP LOCKED: a credit another transaction is taking is not this one's.
  const takeAvailable = SqlSchema.findOneOption({
    Request: Schema.Struct({
      userId: Schema.String,
      feature: CreditFeature,
      usedFor: Schema.String,
      consumedAt: Schema.DateTimeUtcFromDate,
    }),
    Result: Schema.Struct({ id: Schema.String }),
    execute: ({ userId, feature, usedFor, consumedAt }) => sql`
      UPDATE feature_credits
      SET consumed_at = ${consumedAt}, used_for = ${usedFor}
      WHERE id = (
        SELECT id FROM feature_credits
        WHERE user_id = ${userId} AND feature = ${feature}
          AND consumed_at IS NULL AND revoked_at IS NULL
        ORDER BY granted_at, payment_id, seq
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `,
  });

  const release = SqlSchema.findOneOption({
    Request: Schema.Struct({ feature: CreditFeature, usedFor: Schema.String }),
    Result: Schema.Struct({ id: Schema.String }),
    execute: ({ feature, usedFor }) => sql`
      UPDATE feature_credits SET consumed_at = NULL, used_for = NULL
      WHERE feature = ${feature} AND used_for = ${usedFor}
      RETURNING id
    `,
  });

  const featuresHeld = SqlSchema.findAll({
    Request: Schema.String,
    Result: Schema.Struct({ feature: CreditFeature }),
    execute: (userId) => sql`
      SELECT DISTINCT feature FROM feature_credits
      WHERE user_id = ${userId} AND revoked_at IS NULL
      ORDER BY feature
    `,
  });

  const holders = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ userId: UserId }),
    execute: () => sql`
      SELECT DISTINCT user_id FROM feature_credits WHERE revoked_at IS NULL
    `,
  });

  const balancesOf = SqlSchema.findAll({
    Request: Schema.String,
    Result: Schema.Struct({
      feature: CreditFeature,
      available: Schema.Int,
      used: Schema.Int,
    }),
    execute: (userId) => sql`
      SELECT feature,
        count(*) FILTER (WHERE consumed_at IS NULL)::int AS available,
        count(*) FILTER (WHERE consumed_at IS NOT NULL)::int AS used
      FROM feature_credits
      WHERE user_id = ${userId} AND revoked_at IS NULL
      GROUP BY feature
      ORDER BY feature
    `,
  });

  const span =
    (name: string) =>
    <A>(self: Effect.Effect<A, SqlError.SqlError | Schema.SchemaError>) =>
      dieOnSchemaError(self).pipe(Effect.withSpan(`CreditRepository.${name}`));

  return CreditRepository.of({
    paymentsWithCredits: (paymentIds) =>
      paymentIds.length === 0
        ? Effect.succeed(new Set())
        : paymentsWithCredits({ paymentIds }).pipe(
            Effect.map(
              (rows): ReadonlySet<PaymentId> =>
                new Set(rows.map(({ paymentId }) => paymentId)),
            ),
            span("paymentsWithCredits"),
          ),

    grant: (row) =>
      // A purchase's credits are made once; a second sync finds them.
      sql`
        INSERT INTO feature_credits ${sql.insert(
          Array.from({ length: row.quantity }, (_, index) => ({
            id: crypto.randomUUID(),
            userId: row.userId,
            paymentId: row.paymentId,
            feature: row.feature,
            seq: index + 1,
            grantedAt: DateTime.toDateUtc(row.grantedAt),
          })),
        )}
        ON CONFLICT (payment_id, feature, seq) DO NOTHING
      `.pipe(Effect.asVoid, span("grant")),

    restore: (userId, paymentIds) =>
      paymentIds.length === 0
        ? Effect.void
        : sql`
            UPDATE feature_credits SET revoked_at = NULL
            WHERE user_id = ${userId} AND revoked_at IS NOT NULL
              AND ${sql.in("payment_id", paymentIds)}
          `.pipe(Effect.asVoid, span("restore")),

    revokeAllBut: (userId, paymentIds, at) =>
      (paymentIds.length === 0
        ? sql`
            UPDATE feature_credits SET revoked_at = ${DateTime.toDateUtc(at)}
            WHERE user_id = ${userId} AND revoked_at IS NULL
          `
        : sql`
            UPDATE feature_credits SET revoked_at = ${DateTime.toDateUtc(at)}
            WHERE user_id = ${userId} AND revoked_at IS NULL
              AND NOT ${sql.in("payment_id", paymentIds)}
          `
      ).pipe(Effect.asVoid, span("revokeAllBut")),

    takeAvailable: (row) =>
      takeAvailable(row).pipe(Effect.map(Option.isSome), span("takeAvailable")),

    release: (feature, usedFor) =>
      release({ feature, usedFor }).pipe(
        Effect.map(Option.isSome),
        span("release"),
      ),

    featuresHeld: (userId) =>
      featuresHeld(userId).pipe(
        Effect.map((rows) => rows.map(({ feature }) => feature)),
        span("featuresHeld"),
      ),

    holders: holders(undefined).pipe(
      Effect.map((rows) => rows.map(({ userId }) => userId)),
      span("holders"),
    ),

    balancesOf: (userId) => balancesOf(userId).pipe(span("balancesOf")),
  });
});

type Sql<A> = Effect.Effect<A, SqlError.SqlError>;

/** The credits of users (`feature_credits`). */
export class CreditRepository extends Context.Service<
  CreditRepository,
  {
    /** Those of these payments that have credits, revoked or not. */
    readonly paymentsWithCredits: (
      paymentIds: ReadonlyArray<PaymentId>,
    ) => Sql<ReadonlySet<PaymentId>>;
    /** Makes a payment's `quantity` credits of a feature, unless it has them. */
    readonly grant: (row: {
      readonly userId: UserId;
      readonly paymentId: PaymentId;
      readonly feature: CreditFeature;
      readonly quantity: number;
      readonly grantedAt: DateTime.Utc;
    }) => Sql<void>;
    /** Takes back the revocation of the user's credits of these payments. */
    readonly restore: (
      userId: UserId,
      paymentIds: ReadonlyArray<PaymentId>,
    ) => Sql<void>;
    /** Revokes the user's credits of every payment but these. */
    readonly revokeAllBut: (
      userId: UserId,
      paymentIds: ReadonlyArray<PaymentId>,
      at: DateTime.Utc,
    ) => Sql<void>;
    /**
     * Marks the user's oldest available credit of the feature as used for
     * `usedFor`; false if they have none.
     */
    readonly takeAvailable: (row: {
      readonly userId: UserId;
      readonly feature: CreditFeature;
      readonly usedFor: string;
      readonly consumedAt: DateTime.Utc;
    }) => Sql<boolean>;
    /** Makes the credit used for `usedFor` available again; false if none. */
    readonly release: (feature: CreditFeature, usedFor: string) => Sql<boolean>;
    /** The features the user has credits of that were not revoked. */
    readonly featuresHeld: (
      userId: UserId,
    ) => Sql<ReadonlyArray<CreditFeature>>;
    /** The users with credits that were not revoked. */
    readonly holders: Sql<ReadonlyArray<UserId>>;
    /** Per feature, the user's available and used credits (not revoked). */
    readonly balancesOf: (userId: UserId) => Sql<
      ReadonlyArray<{
        readonly feature: CreditFeature;
        readonly available: number;
        readonly used: number;
      }>
    >;
  }
>()("@unhalteproblem.de/backend/domains/credits/CreditRepository") {
  /** Needs a migrated `SqlClient`. */
  static readonly layer = Layer.effect(CreditRepository, make);
}
