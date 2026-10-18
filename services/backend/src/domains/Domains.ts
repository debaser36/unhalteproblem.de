import { Layer } from "effect";
import { DomainEvents } from "#cqrs/DomainEvent";
import { Transaction } from "#cqrs/Transaction";
import { UsersLive } from "./users/Users.ts";

/**
 * Every domain, on one shared `Transaction` and `DomainEvents`. A new
 * domain gets its own folder next to `users/` and its layer is added here.
 *
 * Provides the domains' services and `Transaction`. `DomainEvents` stays
 * internal, so nothing outside a transaction can publish events.
 *
 * Needs a migrated `SqlClient` (`DatabaseLive` or `DatabaseTest`) and
 * `Sessions` (restricting a user ends their sessions).
 */
export const DomainsLive = Layer.mergeAll(UsersLive).pipe(
  Layer.provideMerge(Transaction.layer),
  Layer.provide(DomainEvents.layer),
);
