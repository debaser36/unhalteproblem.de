import { Effect, Layer, Option } from "effect";
import * as Outbox from "#cqrs/Outbox";
import { Mailer } from "#services/Mailer";
import { SendContactMail, type SendContactMailPayload } from "./Contact.ts";
import { ContactRepository } from "./ContactRepository.ts";

// The sender's name goes into the subject; line breaks there would let it
// add headers.
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Handles one `SendContactMail` message: mails the owner about the stored
 * contact message. A message purged before its mail went out is skipped.
 * The Reply-To is the sender's address, so answering the mail answers the
 * visitor.
 *
 * Needs `ContactRepository` and a `Mailer`.
 */
export const sendContactMail = Effect.gen(function* () {
  const repository = yield* ContactRepository;
  const mailer = yield* Mailer;
  return Effect.fn("ContactMail.send")(function* (
    payload: SendContactMailPayload,
  ) {
    const stored = yield* repository.findById(payload.messageId);
    if (Option.isNone(stored)) {
      yield* Effect.logInfo("Contact message gone before its mail").pipe(
        Effect.annotateLogs({ messageId: payload.messageId }),
      );
      return;
    }
    const { id, name, email, message } = stored.value;
    yield* mailer.notifyOwner({
      id: `contact-${id}`,
      subject: `Contact form: ${oneLine(name)}`,
      text: `From: ${name} <${email}>\n\n${message}\n`,
      replyTo: email,
    });
  });
});

/**
 * Mails the owner about every stored contact message, from the outbox: at
 * least once, with retries when the SMTP server is down.
 *
 * Needs `Outbox`, `ContactRepository` and a `Mailer`.
 */
export const ContactMail = Layer.unwrap(
  sendContactMail.pipe(
    Effect.map((handle) => Outbox.consumer(SendContactMail, handle)),
  ),
);
