import { Layer } from "effect";
import { DomainEvents } from "#cqrs/DomainEvent";
import { Outbox } from "#cqrs/Outbox";
import { Transaction } from "#cqrs/Transaction";
import { ContactLive } from "./contact/Contacts.ts";
import { ModerationLive } from "./moderation/Moderations.ts";
import { UserDirectoryLive, UsersLive } from "./users/Users.ts";

// Moderation acts on users (through their directory), and registering a user
// grants their first roles (through moderation): users' directory, then
// moderation, then the rest of users.
const Moderation = ModerationLive.pipe(Layer.provide(UserDirectoryLive));

/**
 * Every domain, on one shared `Transaction`, `DomainEvents` and `Outbox`. A
 * new domain gets its own folder next to `users/` and its layer is added
 * here.
 *
 * Provides the domains' services and `Transaction`. `DomainEvents` and
 * `Outbox` stay internal, so nothing outside a transaction can publish
 * events or enqueue messages.
 *
 * Needs a migrated `SqlClient` (`DatabaseLive` or `DatabaseTest`),
 * `Sessions` (restricting a user ends their sessions) and a `Mailer`.
 */
export const DomainsLive = Layer.mergeAll(UsersLive, ContactLive).pipe(
  Layer.provideMerge(Moderation),
  Layer.provideMerge(Transaction.layer),
  Layer.provide([DomainEvents.layer, Outbox.layer]),
);
