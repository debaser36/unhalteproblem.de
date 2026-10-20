import { IsoDateTimeUtc } from "#domain/IsoDateTimeUtc";
import { type DateTime, Effect, Schema, SchemaGetter } from "effect";

/**
 * Length limits for the contact form, exported so the website can use the
 * same values for `maxLength` attributes and character counters.
 *
 * Lengths are measured in UTF-16 code units (`string.length`), which is what
 * both `Schema.isMaxLength` and the browser's `maxlength` attribute count.
 */
export const ContactMessageLimits = {
  /** Generous for full names, short enough to keep e-mail subjects sane. */
  nameMaxLength: 100,
  /** RFC 5321 caps a forward-path at 256 octets, i.e. 254 for the address. */
  emailMaxLength: 254,
  /** Roughly a page of text; longer enquiries should go by e-mail. */
  messageMaxLength: 5000,
} as const;

// The strings are validated as already trimmed (`Schema.Trimmed`) rather than
// trimmed during decoding (`Schema.Trim`). With `Schema.Trim` the generated
// client still rejects untrimmed input when encoding, and the OpenAPI document
// would lose every constraint because only the encoded side (a plain string)
// is documented. Clients therefore trim before sending, and both sides apply
// exactly the same rules.

// Postgres `text` cannot store U+0000, so such a submission would pass
// validation and then fail in the database with a 500. Reject it here instead.
// The `u` flag is required for `Schema.isPattern` to export the pattern to
// JSON Schema.
// oxlint-disable-next-line no-control-regex -- matching NUL is the point
const NO_NUL_PATTERN = /^[^\u0000]*$/u;
const noNul = Schema.isPattern(NO_NUL_PATTERN, {
  expected: "text without NUL characters",
});

/** The sender's name: trimmed, 1 to 100 characters, no NUL. */
export const ContactName = Schema.Trimmed.check(
  noNul,
  Schema.isNonEmpty(),
  Schema.isMaxLength(ContactMessageLimits.nameMaxLength),
).annotate({ description: "The sender's name." });

// Deliberately pragmatic: one "@", no whitespace, and a domain with at least
// one dot and no empty labels. Full RFC 5322 validation rejects little that
// matters here; deliverability is only proven by actually replying. The `u`
// flag is required for `Schema.isPattern` to export the pattern to JSON
// Schema.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u;

/** The address to reply to: trimmed, at most 254 characters, e-mail shaped. */
export const ContactEmail = Schema.Trimmed.check(
  noNul,
  Schema.isMaxLength(ContactMessageLimits.emailMaxLength),
  Schema.isPattern(EMAIL_PATTERN, {
    expected: "an e-mail address",
    toJsonSchema: () => ({ pattern: EMAIL_PATTERN.source, format: "email" }),
  }),
).annotate({ description: "The address a reply should be sent to." });

/** The message text: trimmed, 1 to 5000 characters, no NUL. */
export const ContactMessageBody = Schema.Trimmed.check(
  noNul,
  Schema.isNonEmpty(),
  Schema.isMaxLength(ContactMessageLimits.messageMaxLength),
).annotate({ description: "The message itself." });

/** Payload of `POST /contact`, submitted by the website's contact form. */
export const ContactMessage = Schema.Struct({
  name: ContactName,
  email: ContactEmail,
  message: ContactMessageBody,
}).annotate({
  identifier: "ContactMessage",
  description: "A message submitted through the website's contact form.",
});
export type ContactMessage = typeof ContactMessage.Type;

/**
 * Our id of a stored contact message (a UUID). The backend's domain uses the
 * same brand name, so values pass between the two without conversion.
 */
export const ContactMessageId = Schema.String.check(Schema.isUUID())
  .pipe(Schema.brand("ContactMessageId"))
  .annotate({
    identifier: "ContactMessageId",
    description: "Our id of a stored contact message (a UUID).",
  });
export type ContactMessageId = typeof ContactMessageId.Type;

/**
 * A stored contact message, as admins read it: what the sender submitted,
 * and when. Personal data: visible to admins only.
 */
export const ReceivedContactMessage = Schema.Struct({
  id: ContactMessageId,
  name: ContactName,
  email: ContactEmail,
  message: ContactMessageBody,
  createdAt: IsoDateTimeUtc,
}).annotate({
  identifier: "ReceivedContactMessage",
  description: "A message received through the contact form.",
});
export type ReceivedContactMessage = typeof ReceivedContactMessage.Type;

/** Paging limits of `GET /admin/contact`. */
export const ContactMessagePageLimits = {
  /** Page size when `limit` is absent. */
  defaultLimit: 50,
  /** Largest page size accepted. */
  maxLimit: 100,
} as const;

/**
 * Longest accepted encoded `ContactMessageCursor`. A real cursor is about 70
 * characters (`[<epoch millis>,"<uuid>"]` in base64url), like `UserCursor`.
 */
export const ContactMessageCursorMaxLength = 128;

/** Decoded form of `ContactMessageCursor`: the position of one message. */
export interface ContactMessageCursorPosition {
  /** `createdAt` of the message, at millisecond precision. */
  readonly createdAt: DateTime.Utc;
  readonly id: ContactMessageId;
}

/**
 * Position in the list of contact messages: the `createdAt` and `id` of the
 * last message of a page. Clients treat it as an opaque string and pass
 * `nextCursor` back as `cursor`.
 *
 * Encoded: base64url (no padding) of the JSON array
 * `[createdAtEpochMillis, messageId]`. Decoded: `{ createdAt, id }`.
 * Anything else fails decoding (400), like `UserCursor`.
 */
export const ContactMessageCursor = Schema.String.annotate({
  description:
    "Opaque position in the list of contact messages: pass the " +
    "`nextCursor` of a page as `cursor` to get the next one.",
}).pipe(
  Schema.check(Schema.isMaxLength(ContactMessageCursorMaxLength)),
  Schema.decodeTo(Schema.StringFromBase64Url),
  Schema.decodeTo(
    Schema.fromJsonString(
      Schema.Tuple([Schema.DateTimeUtcFromMillis, ContactMessageId]),
    ),
  ),
  Schema.decodeTo(
    Schema.Struct({
      createdAt: Schema.DateTimeUtc,
      // Only the Type of `ContactMessageId`: the tuple above has validated it.
      id: Schema.toType(ContactMessageId),
    }),
    {
      decode: SchemaGetter.transform(([createdAt, id]) => ({ createdAt, id })),
      encode: SchemaGetter.transform(
        ({ createdAt, id }) => [createdAt, id] as const,
      ),
    },
  ),
  Schema.annotate({ identifier: "ContactMessageCursor" }),
);
export type ContactMessageCursor = typeof ContactMessageCursor.Type;

/**
 * Query of `GET /admin/contact`. Messages are ordered by `createdAt`, then
 * `id`, descending (newest first). Decoding fills in the default `limit`; in
 * the generated client `limit` is therefore required (pass
 * `ContactMessagePageLimits.defaultLimit`).
 */
export const ContactMessagePageQuery = Schema.Struct({
  /** Page size, 1 to 100; 50 by default. */
  limit: Schema.Int.check(
    Schema.isBetween({
      minimum: 1,
      maximum: ContactMessagePageLimits.maxLimit,
    }),
  )
    // Described on the key, before the default (see `UserPageQuery`).
    .annotateKey({
      description: "Page size, an integer from 1 to 100; 50 if absent.",
    })
    .pipe(
      Schema.withDecodingDefaultKey(
        Effect.succeed(ContactMessagePageLimits.defaultLimit),
      ),
    ),
  /** The `nextCursor` of the previous page; absent for the first page. */
  cursor: Schema.optionalKey(ContactMessageCursor).annotateKey({
    description:
      "The `nextCursor` of the previous page; leave out for the first page.",
  }),
}).annotate({ identifier: "ContactMessagePageQuery" });
export type ContactMessagePageQuery = typeof ContactMessagePageQuery.Type;

/** Body of `GET /admin/contact`: one page of contact messages. */
export const ContactMessagePage = Schema.Struct({
  messages: Schema.Array(ReceivedContactMessage),
  /**
   * The position after the last returned message, to pass as `cursor` for
   * the next page; `null` on the last page.
   */
  nextCursor: Schema.NullOr(ContactMessageCursor),
}).annotate({
  identifier: "ContactMessagePage",
  description:
    "One page of contact messages, newest first (by `createdAt`, then " +
    "`id`). `nextCursor` is the position after the last returned message, " +
    "or null on the last page.",
});
export type ContactMessagePage = typeof ContactMessagePage.Type;
