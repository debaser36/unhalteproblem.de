import { Effect, Match } from "effect";
import * as DomainEvent from "#cqrs/DomainEvent";
import { ContactMessageReceived } from "./Contact.ts";

/** Logs the contact domain's events: the message id only, never its text. */
export const ContactEventLog = DomainEvent.subscriber(
  "ContactEventLog",
  ContactMessageReceived,
  (event) =>
    Match.valueTags(event, {
      ContactMessageReceived: ({ messageId }) =>
        Effect.logInfo("Contact message received").pipe(
          Effect.annotateLogs({ messageId }),
        ),
    }),
);
