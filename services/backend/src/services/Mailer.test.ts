import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { createServer, type Server } from "node:net";
import type { MailSettings } from "#Config";
import { MailFailed, Mailer } from "./Mailer.ts";

/**
 * A minimal SMTP server: accepts one mail per connection and records what
 * came in DATA.
 */
const smtpServer = Effect.acquireRelease(
  Effect.callback<{ readonly server: Server; readonly mails: Array<string> }>(
    (resume) => {
      const mails: Array<string> = [];
      const server = createServer((socket) => {
        let data = "";
        let inData = false;
        socket.write("220 test ESMTP\r\n");
        socket.on("data", (chunk) => {
          for (const line of chunk.toString().split(/(?<=\r\n)/)) {
            if (inData) {
              if (line === ".\r\n") {
                inData = false;
                mails.push(data);
                data = "";
                socket.write("250 queued\r\n");
              } else {
                data += line;
              }
            } else if (/^EHLO/i.test(line)) {
              socket.write("250 test\r\n");
            } else if (/^DATA/i.test(line)) {
              inData = true;
              socket.write("354 go ahead\r\n");
            } else if (/^QUIT/i.test(line)) {
              socket.end("221 bye\r\n");
            } else {
              socket.write("250 ok\r\n");
            }
          }
        });
      });
      server.listen(0, "127.0.0.1", () =>
        resume(Effect.succeed({ server, mails })),
      );
    },
  ),
  ({ server }) =>
    Effect.callback<void>((resume) => {
      server.close(() => resume(Effect.void));
    }),
);

const settings = (port: number): MailSettings => ({
  host: "127.0.0.1",
  port,
  security: "none",
  auth: Option.none(),
  from: "Website <noreply@example.org>",
  to: "owner@example.org",
});

const withMailer = (port: number) =>
  Effect.provide(Mailer.layerSmtp(settings(port)));

describe("Mailer.layerSmtp", () => {
  it.live("sends a mail to the owner with a stable message id", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { server, mails } = yield* smtpServer;
        const port = (server.address() as { port: number }).port;
        yield* Effect.gen(function* () {
          const mailer = yield* Mailer;
          yield* mailer.notifyOwner({
            id: "contact-1",
            subject: "Contact form: Ada",
            text: "Hello!",
            replyTo: "ada@example.org",
          });
        }).pipe(withMailer(port));

        assert.strictEqual(mails.length, 1);
        const mail = mails[0] ?? "";
        assert.match(mail, /^From: Website <noreply@example.org>\r?$/m);
        assert.match(mail, /^To: owner@example.org\r?$/m);
        assert.match(mail, /^Reply-To: ada@example.org\r?$/m);
        assert.match(mail, /^Subject: Contact form: Ada\r?$/m);
        assert.match(mail, /^Message-ID: <contact-1@example.org>\r?$/m);
        assert.include(mail, "Hello!");
      }),
    ),
  );

  it.live(
    "fails with a short code, not the server's words, when it cannot connect",
    () =>
      Effect.gen(function* () {
        // A port nothing listens on: bind one, then close it.
        const port = yield* Effect.scoped(
          Effect.gen(function* () {
            const { server } = yield* smtpServer;
            return (server.address() as { port: number }).port;
          }),
        );
        const error = yield* Effect.gen(function* () {
          const mailer = yield* Mailer;
          return yield* mailer.notifyOwner({
            id: "contact-2",
            subject: "s",
            text: "t",
          });
        }).pipe(withMailer(port), Effect.flip);
        assert.instanceOf(error, MailFailed);
        assert.match(error.reason, /^[A-Z_]+$/);
      }),
  );
});
