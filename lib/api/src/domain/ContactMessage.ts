import { Schema } from "effect";

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
