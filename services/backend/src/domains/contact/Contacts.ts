import { Layer } from "effect";
import { ContactCleanup } from "./ContactCleanup.ts";
import { ContactCommands } from "./ContactCommands.ts";
import { ContactEventLog } from "./ContactEventLog.ts";
import { ContactMail } from "./ContactMail.ts";
import { ContactRepository } from "./ContactRepository.ts";

/**
 * The contact domain: provides `ContactCommands` and runs the mail
 * consumer, the retention job and the event log. The repository stays
 * internal.
 *
 * Needs a migrated `SqlClient`, `Transaction`, `DomainEvents`, `Outbox` and
 * a `Mailer`.
 */
export const ContactLive = Layer.mergeAll(
  ContactMail,
  ContactCleanup,
  ContactEventLog,
).pipe(
  Layer.provideMerge(ContactCommands.layer),
  Layer.provide(ContactRepository.layer),
);
