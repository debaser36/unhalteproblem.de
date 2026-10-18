import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { createTransport } from "nodemailer";
import { MailConfig, type MailSettings } from "#Config";

/** A mail to the site's owner (`CONTACT_MAIL_TO`) from the website (`SMTP_FROM`). */
export interface Mail {
  readonly subject: string;
  readonly text: string;
  /** One address where a reply goes. */
  readonly replyTo?: string;
  /**
   * A stable id for this mail, without the angle brackets. If the same mail
   * is sent twice (a retry after a timeout), both copies carry it, so the
   * recipient's client can show them as one.
   */
  readonly id: string;
}

/**
 * The mail could not be handed to the server. `reason` is a short code for
 * the log and for `outbox.last_error`; it never quotes the mail.
 */
export class MailFailed extends Schema.TaggedError<
  MailFailed,
  { readonly brand: unique symbol }
>()("MailFailed", { reason: Schema.String }) {}

/** Sends mail. */
export class Mailer extends Context.Service<
  Mailer,
  {
    /** Mails the site's owner. */
    readonly notifyOwner: (mail: Mail) => Effect.Effect<void, MailFailed>;
  }
>()("@unhalteproblem.de/backend/Mailer") {
  /**
   * Sends through an SMTP server. Connects per mail and gives up on a stuck
   * server after the timeouts below, so a hung server blocks the outbox
   * worker for at most that long.
   */
  static readonly layerSmtp = (settings: MailSettings) =>
    Layer.effect(
      Mailer,
      Effect.gen(function* () {
        const transport = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createTransport({
              host: settings.host,
              port: settings.port,
              secure: settings.security === "tls",
              requireTLS: settings.security === "starttls",
              ignoreTLS: settings.security === "none",
              connectionTimeout: 10_000,
              greetingTimeout: 10_000,
              socketTimeout: 30_000,
              ...(Option.isSome(settings.auth)
                ? {
                    auth: {
                      user: settings.auth.value.user,
                      pass: Redacted.value(settings.auth.value.password),
                    },
                  }
                : {}),
            }),
          ),
          (transport) => Effect.sync(() => transport.close()),
        );
        return Mailer.of({
          notifyOwner: Effect.fn("Mailer.notifyOwner")(function* (mail) {
            yield* Effect.tryPromise({
              try: (signal) => {
                signal.throwIfAborted();
                return transport.sendMail({
                  from: settings.from,
                  to: settings.to,
                  subject: mail.subject,
                  text: mail.text,
                  messageId: `<${mail.id}@${messageIdHost(settings.from)}>`,
                  ...(mail.replyTo === undefined
                    ? {}
                    : // An object, so nodemailer takes it as one address and
                      // not as a list (`a@b.de, c@d.de`).
                      { replyTo: { name: "", address: mail.replyTo } }),
                });
              },
              // The error text can quote the recipient or the server's
              // answer; only its code is kept.
              catch: (error) =>
                new MailFailed({
                  reason:
                    typeof error === "object" &&
                    error !== null &&
                    "code" in error &&
                    typeof error.code === "string"
                      ? error.code
                      : "smtp",
                }),
            });
          }),
        });
      }),
    );

  /**
   * For deployments without SMTP: mails are not sent, which is logged once
   * per mail (without its content). The outbox message completes, so
   * nothing piles up; the contact message itself stays in the database.
   */
  static readonly layerDisabled = Layer.succeed(
    Mailer,
    Mailer.of({
      notifyOwner: Effect.fn("Mailer.notifyOwner")(function* (mail) {
        yield* Effect.logWarning("Mail not sent: SMTP is not configured").pipe(
          Effect.annotateLogs({ mailId: mail.id }),
        );
      }),
    }),
  );

  /**
   * SMTP when `SMTP_HOST` is set (see `MailConfig`), else the disabled
   * mailer.
   */
  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const settings = yield* MailConfig;
      return Option.isSome(settings)
        ? Mailer.layerSmtp(settings.value)
        : Mailer.layerDisabled;
    }),
  );
}

/** The domain of the sender's address, for Message-IDs. */
const messageIdHost = (from: string): string => {
  const domain = /@([^\s>]+)>?\s*$/.exec(from)?.[1];
  return domain ?? "localhost";
};
