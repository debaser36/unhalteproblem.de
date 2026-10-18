import { Layer } from "effect";
import { DomainEvents } from "#cqrs/DomainEvent";
import { Outbox } from "#cqrs/Outbox";
import { Transaction } from "#cqrs/Transaction";
import { UsersLive } from "./users/Users.ts";

/**
 * Every domain, on one shared `Transaction`, `DomainEvents` and `Outbox`. A
 * new domain gets its own folder next to `users/` and its layer is added
 * here.
 *
 * Provides the domains' services and `Transaction`. `DomainEvents` and
 * `Outbox` stay internal, so nothing outside a transaction can publish
 * events or enqueue messages.
 *
 * Needs a migrated `SqlClient` (`DatabaseLive` or `DatabaseTest`) and
 * `Sessions` (restricting a user ends their sessions).
 */
export const DomainsLive = Layer.mergeAll(UsersLive).pipe(
  Layer.provideMerge(Transaction.layer),
  Layer.provide([DomainEvents.layer, Outbox.layer]),
);
