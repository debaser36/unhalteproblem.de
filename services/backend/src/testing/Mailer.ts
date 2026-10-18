import { Effect, Layer } from "effect";
import { type Mail, Mailer } from "#services/Mailer";

/**
 * A `Mailer` that records the mails instead of sending them. Test support
 * only, like everything in `#testing/*`.
 */
export const makeRecordingMailer = () => {
  const sent: Array<Mail> = [];
  const layer = Layer.succeed(
    Mailer,
    Mailer.of({
      notifyOwner: (mail) =>
        Effect.sync(() => {
          sent.push(mail);
        }),
    }),
  );
  return { sent, layer };
};
