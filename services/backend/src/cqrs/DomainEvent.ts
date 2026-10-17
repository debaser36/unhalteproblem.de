import {
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  type Option,
  PubSub,
  Schema,
  type Scope,
} from "effect";

/**
 * Something that happened in a domain, named in the past tense
 * (`UserRegistered`). Each domain defines its events as
 * `Schema.TaggedClass`es.
 */
export interface DomainEvent {
  readonly _tag: string;
}

/**
 * The innermost `Transaction.run` a fiber runs in: the events recorded in it
 * so far, and the SQL transaction depth it opened. Only `Transaction`
 * creates these.
 */
export interface UnitOfWork {
  readonly events: Array<DomainEvent>;
  /** 0 for a transaction, 1 and up for savepoints. */
  readonly depth: number;
  /** The SQL client's current transaction depth, as seen by the caller. */
  readonly currentDepth: Effect.Effect<Option.Option<number>>;
  /** False once the run has ended; recording then is a bug. */
  open: boolean;
}

/** The current `UnitOfWork`, or `undefined` outside of a `Transaction.run`. */
export const CurrentUnitOfWork = Context.Reference<UnitOfWork | undefined>(
  "@unhalteproblem.de/backend/cqrs/CurrentUnitOfWork",
  { defaultValue: () => undefined },
);

/**
 * Records events in the current transaction. They are published once the
 * outermost transaction has committed, and dropped if it (or the savepoint
 * they were recorded in) rolls back.
 *
 * Recording where the events could get lost or outlive a rollback is a bug,
 * so it dies: outside a `Transaction.run` (a command that forgot its
 * boundary), after the run ended (a fiber that outlived its command), or
 * inside a `sql.withTransaction` that `Transaction` didn't open.
 */
export const record = Effect.fnUntraced(function* (
  ...events: ReadonlyArray<DomainEvent>
) {
  const unit = yield* CurrentUnitOfWork;
  if (unit === undefined) {
    return yield* Effect.die(
      new Error("Domain events can only be recorded inside a transaction"),
    );
  }
  if (!unit.open) {
    return yield* Effect.die(
      new Error("Domain events recorded after their transaction ended"),
    );
  }
  const depth = yield* unit.currentDepth;
  if (depth._tag === "None" || depth.value !== unit.depth) {
    return yield* Effect.die(
      new Error(
        "Domain events recorded inside a sql.withTransaction; use Transaction.run",
      ),
    );
  }
  unit.events.push(...events);
});

/**
 * How many events may wait for the slowest subscriber. More are dropped
 * (and logged) rather than blocking the commit or growing without bound.
 */
const capacity = 4096;

/**
 * Delivers committed domain events to in-process subscribers.
 *
 * Delivery is at most once: events live in memory only, so the ones not yet
 * handled when the process stops are lost, and so are events beyond the
 * capacity of a subscriber that falls behind. Subscribers must not be the
 * only place a business rule is enforced; anything that has to happen
 * together with a change belongs into the command itself.
 */
export class DomainEvents extends Context.Service<
  DomainEvents,
  {
    /** Hands committed events to the subscribers. Only `Transaction` calls this. */
    readonly publish: (
      events: ReadonlyArray<DomainEvent>,
    ) => Effect.Effect<void>;
    /** Receives every event published after this call, for as long as the scope lives. */
    readonly subscribe: Effect.Effect<
      PubSub.Subscription<DomainEvent>,
      never,
      Scope.Scope
    >;
  }
>()("@unhalteproblem.de/backend/cqrs/DomainEvents") {
  static readonly layer = Layer.effect(
    DomainEvents,
    Effect.gen(function* () {
      const pubsub = yield* Effect.acquireRelease(
        PubSub.dropping<DomainEvent>(capacity),
        PubSub.shutdown,
      );
      return DomainEvents.of({
        publish: Effect.fnUntraced(function* (events) {
          if (events.length === 0) return;
          const delivered = yield* PubSub.publishAll(pubsub, events);
          if (!delivered) {
            yield* Effect.logWarning(
              "Domain events dropped: a subscriber is behind",
            ).pipe(
              Effect.annotateLogs({
                events: events.map((event) => event._tag).join(","),
              }),
            );
          }
        }),
        subscribe: PubSub.subscribe(pubsub),
      });
    }),
  );
}

/**
 * A background subscriber that runs `handle` for every committed event
 * `schema` accepts, one at a time and in publication order.
 *
 * It runs after the commit, outside of any transaction; if it changes state,
 * it does so through a command. A handler that fails, dies or is
 * interrupted is logged, and the subscriber continues with the next event.
 */
export const subscriber = <S extends Schema.Constraint, R>(
  name: string,
  schema: S,
  handle: (event: S["Type"]) => Effect.Effect<void, unknown, R>,
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const domainEvents = yield* DomainEvents;
      // Subscribed while the layer is built, so no event published after
      // startup is missed.
      const subscription = yield* domainEvents.subscribe;
      const matches = Schema.is(schema);
      yield* PubSub.take(subscription).pipe(
        Effect.flatMap((event) =>
          matches(event)
            ? // In a child fiber, so that whatever ends the handler, even an
              // interruption from inside it, ends only this event's run.
              // Interrupting the subscriber interrupts the child too.
              Effect.forkChild(handle(event).pipe(Effect.withSpan(name))).pipe(
                Effect.flatMap(Fiber.await),
                Effect.flatMap((exit) =>
                  Exit.isSuccess(exit)
                    ? Effect.void
                    : Effect.logError(
                        "Domain event subscriber failed",
                        exit.cause,
                      ).pipe(
                        Effect.annotateLogs({
                          subscriber: name,
                          event: event._tag,
                        }),
                      ),
                ),
              )
            : Effect.void,
        ),
        Effect.forever,
        Effect.forkScoped,
      );
    }),
  );
