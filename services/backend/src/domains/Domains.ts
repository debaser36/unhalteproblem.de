import { Layer } from "effect";
import { DomainEvents } from "#cqrs/DomainEvent";
import { Outbox } from "#cqrs/Outbox";
import { Transaction } from "#cqrs/Transaction";
import { AuditLive } from "./audit/Audits.ts";
import { BlogDirectoryLive, BlogsLive } from "./blogs/Blogs.ts";
import { ContactLive } from "./contact/Contacts.ts";
import { CreditsLive } from "./credits/Credits.ts";
import { FoodLive } from "./food/Foods.ts";
import { MediaLive } from "./media/Medias.ts";
import { ModerationLive } from "./moderation/Moderations.ts";
import { PaymentsLive } from "./payments/Payments.ts";
import { OperationsLive } from "./operations/Operations.ts";
import { ProjectsLive } from "./projects/Projects.ts";
import { UserDirectoryLive, UsersLive } from "./users/Users.ts";

// Moderation acts on users (through their directory), and registering a user
// grants their first roles (through moderation): users' directory, then
// moderation, then the rest of users. Moderation also asks the blogs'
// directory before it grants an editor role. Approving a blog request in
// turn grants the editor role through moderation, which the blogs layer gets
// from the `provideMerge(Moderation)` below.
const Moderation = ModerationLive.pipe(
  Layer.provide([UserDirectoryLive, BlogDirectoryLive]),
);

// Posts name their authors, posts and projects record who changed them, and
// their images live in the media domain.
const Blogs = BlogsLive.pipe(Layer.provide(UserDirectoryLive));
const Projects = ProjectsLive.pipe(Layer.provide(UserDirectoryLive));

// Admins deleting contact messages and retrying outbox messages are audited
// by our id.
const Contact = ContactLive.pipe(Layer.provide(UserDirectoryLive));
const Operations = OperationsLive.pipe(Layer.provide(UserDirectoryLive));

// Credits belong to users (by our id).
const Credits = CreditsLive.pipe(Layer.provide(UserDirectoryLive));

// Meal plans belong to users (by our id), and those of users without
// `foodPlanner` use credits.
const Food = FoodLive.pipe(Layer.provide([UserDirectoryLive, Credits]));

// Payments grant and revoke roles through moderation and credits, and
// deleting an account (users) cancels its subscriptions through payments:
// payments sit between moderation and the rest of users.
const Payments = PaymentsLive.pipe(Layer.provide([UserDirectoryLive, Credits]));

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
 * `Sessions` (restricting a user ends their sessions), a `Mailer`,
 * `KeycloakAdmin`, `Stripe`, and the food planner's sources (`OpenPrices`,
 * `OpenFoodFacts`, `StatsNz`, `Claude`).
 */
export const DomainsLive = Layer.mergeAll(
  UsersLive,
  Contact,
  Blogs,
  Projects,
  Operations,
  Food,
).pipe(
  Layer.provideMerge(Payments),
  Layer.provideMerge(Moderation),
  Layer.provideMerge(MediaLive),
  Layer.provideMerge(AuditLive),
  Layer.provideMerge(Transaction.layer),
  Layer.provide([DomainEvents.layer, Outbox.layer]),
);
