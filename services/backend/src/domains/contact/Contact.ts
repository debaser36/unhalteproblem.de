import {
  ContactEmail,
  ContactMessageBody,
  ContactName,
} from "@unhalteproblem.de/api";
import { DateTime, Schema } from "effect";
import * as Outbox from "#cqrs/Outbox";

/** Our id of a contact message. */
export const ContactMessageId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("ContactMessageId"),
);
export type ContactMessageId = typeof ContactMessageId.Type;

/** A message from the website's contact form, as stored. */
export class StoredContactMessage extends Schema.Class<
  StoredContactMessage,
  { readonly brand: unique symbol }
>("StoredContactMessage")({
  id: ContactMessageId,
  name: ContactName,
  email: ContactEmail,
  message: ContactMessageBody,
  createdAt: Schema.DateTimeUtcFromDate,
}) {}

// Events

/** A contact message was stored. Carries the id only: the rest is personal data. */
export class ContactMessageReceived extends Schema.TaggedClass<
  ContactMessageReceived,
  { readonly brand: unique symbol }
>()("ContactMessageReceived", { messageId: ContactMessageId }) {}

// Outbox

/**
 * Mail the owner about a stored contact message. The payload is the id, not
 * the text: the message is read when the mail is sent, so the outbox row
 * holds no personal data, and a message purged in the meantime is not mailed.
 */
export const SendContactMailPayload = Schema.Struct({
  messageId: ContactMessageId,
});
export type SendContactMailPayload = typeof SendContactMailPayload.Type;

export const SendContactMail = Outbox.topic(
  "contact.send-mail",
  SendContactMailPayload,
);

// Rules

/** The moment before which stored messages are deleted. */
export const retentionCutoff = (
  now: DateTime.Utc,
  retention: Parameters<typeof DateTime.subtractDuration>[1],
): DateTime.Utc => DateTime.subtractDuration(now, retention);
