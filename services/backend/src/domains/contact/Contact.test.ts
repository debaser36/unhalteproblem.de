import { assert, describe, layer } from "@effect/vitest";
import {
  Cause,
  DateTime,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  PubSub,
} from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import * as DomainEvent from "#cqrs/DomainEvent";
import { Outbox } from "#cqrs/Outbox";
import { Transaction } from "#cqrs/Transaction";
import { AuditCommands } from "#domains/audit/AuditCommands";
import { AuditRepository } from "#domains/audit/AuditRepository";
import { UserDirectoryLive } from "#domains/users/Users";
import { MailFailed, Mailer } from "#services/Mailer";
import { DatabaseTest } from "#testing/Database";
import { makeRecordingMailer } from "#testing/Mailer";
import {
  ContactMessageId,
  SendContactMail,
  StoredContactMessage,
} from "./Contact.ts";
import { ContactCommands } from "./ContactCommands.ts";
import { sendContactMail } from "./ContactMail.ts";
import { ContactRepository } from "./ContactRepository.ts";

const ada = {
  name: "Ada\r\nBcc: evil@example.org",
  email: "ada@example.org",
  message: "Hello!",
};

const mailer = makeRecordingMailer();

const TestLayer = ContactCommands.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Outbox.layer,
      ContactRepository.layer,
      mailer.layer,
      AuditCommands.layer.pipe(Layer.provide(AuditRepository.layer)),
      UserDirectoryLive,
    ),
  ),
  Layer.provideMerge(Transaction.layer),
  Layer.provideMerge(DomainEvent.DomainEvents.layer),
  Layer.provideMerge(DatabaseTest),
);

const clear = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM contact_messages`;
  yield* sql`DELETE FROM outbox`;
  mailer.sent.length = 0;
});

const storedNames = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly name: string;
  }>`SELECT name FROM contact_messages ORDER BY created_at, name`;
  return rows.map((row) => row.name);
});

describe("contact domain", () => {
  layer(TestLayer, { timeout: "30 seconds" })((it) => {
    it.effect("stores a message and promises a mail in one go", () =>
      Effect.gen(function* () {
        yield* clear;
        const commands = yield* ContactCommands;
        const domainEvents = yield* DomainEvent.DomainEvents;
        const subscription = yield* domainEvents.subscribe;
        yield* commands.submit(ada);

        assert.deepStrictEqual(yield* storedNames, [ada.name]);
        const outbox = yield* Outbox;
        const handled: Array<string> = [];
        const claimed = yield* outbox.process(
          SendContactMail,
          ({ messageId }) => Effect.sync(() => void handled.push(messageId)),
        );
        assert.strictEqual(claimed, 1);
        assert.strictEqual(handled.length, 1);

        const events = yield* PubSub.takeUpTo(subscription, 10);
        assert.deepStrictEqual(
          events.map((event) => event._tag),
          ["ContactMessageReceived"],
        );
      }),
    );

    it.effect("mails the owner with the visitor as reply-to", () =>
      Effect.gen(function* () {
        yield* clear;
        const commands = yield* ContactCommands;
        const outbox = yield* Outbox;
        const handle = yield* sendContactMail;
        yield* commands.submit(ada);
        yield* outbox.process(SendContactMail, handle);

        assert.strictEqual(mailer.sent.length, 1);
        const [mail] = mailer.sent;
        // No line break survives into a header.
        assert.strictEqual(
          mail?.subject,
          "Contact form: Ada Bcc: evil@example.org",
        );
        assert.strictEqual(mail?.replyTo, "ada@example.org");
        assert.include(mail?.text ?? "", "Hello!");
        assert.match(mail?.id ?? "", /^contact-[0-9a-f-]{36}$/);
      }),
    );

    it.effect("skips the mail of a message that was purged meanwhile", () =>
      Effect.gen(function* () {
        yield* clear;
        const commands = yield* ContactCommands;
        const outbox = yield* Outbox;
        const handle = yield* sendContactMail;
        yield* commands.submit(ada);
        yield* TestClock.adjust("100 days");
        assert.strictEqual(yield* commands.purgeOlderThan("90 days"), 1);

        assert.strictEqual(yield* outbox.process(SendContactMail, handle), 1);
        assert.strictEqual(mailer.sent.length, 0);
      }),
    );

    it.effect("purges only messages older than the retention", () =>
      Effect.gen(function* () {
        yield* clear;
        const commands = yield* ContactCommands;
        yield* commands.submit({ ...ada, name: "old" });
        yield* TestClock.adjust("60 days");
        yield* commands.submit({ ...ada, name: "newer" });
        yield* TestClock.adjust("40 days");
        // "old" is 100 days old, "newer" 40.
        assert.strictEqual(yield* commands.purgeOlderThan("90 days"), 1);
        assert.deepStrictEqual(yield* storedNames, ["newer"]);
        assert.strictEqual(yield* commands.purgeOlderThan("90 days"), 0);
      }),
    );

    it.effect("retries the mail while the SMTP server is down", () =>
      Effect.gen(function* () {
        yield* clear;
        const commands = yield* ContactCommands;
        const outbox = yield* Outbox;
        const sql = yield* SqlClient.SqlClient;
        let up = false;
        const sent: Array<string> = [];
        const handle = yield* sendContactMail.pipe(
          Effect.provideService(
            Mailer,
            Mailer.of({
              notifyOwner: (mail) =>
                up
                  ? Effect.sync(() => void sent.push(mail.id))
                  : Effect.fail(new MailFailed({ reason: "ECONNREFUSED" })),
            }),
          ),
        );
        const options = { backoff: () => Duration.seconds(10) };
        yield* commands.submit(ada);

        yield* outbox.process(SendContactMail, handle, options);
        const [row] = yield* sql<{
          readonly lastError: string;
        }>`SELECT last_error FROM outbox`;
        assert.strictEqual(row?.lastError, "MailFailed:ECONNREFUSED");
        assert.deepStrictEqual(sent, []);

        up = true;
        yield* TestClock.adjust("11 seconds");
        yield* outbox.process(SendContactMail, handle, options);
        assert.strictEqual(sent.length, 1);
        assert.strictEqual((yield* sql`SELECT 1 FROM outbox`).length, 0);
      }),
    );

    it.effect("keeps a missing message from being found", () =>
      Effect.gen(function* () {
        const repository = yield* ContactRepository;
        const found = yield* repository.findById(
          ContactMessageId.make("00000000-0000-4000-8000-000000000000"),
        );
        assert.isTrue(Option.isNone(found));
      }),
    );
  });
});

describe("contact repository failures", () => {
  layer(TestLayer, { timeout: "30 seconds" })((it) => {
    it.effect("do not quote the message they were about", () =>
      Effect.gen(function* () {
        yield* clear;
        const repository = yield* ContactRepository;
        const message = new StoredContactMessage({
          id: ContactMessageId.make("11111111-1111-4111-8111-111111111111"),
          name: "Grace Hopper",
          email: "grace@example.org",
          message: "A very private question",
          createdAt: DateTime.makeUnsafe(0),
        });
        yield* repository.insert(message);
        // The same id again: a unique violation.
        const exit = yield* repository.insert(message).pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(exit));
        const text = Cause.pretty(
          (exit as Exit.Failure<unknown, unknown>).cause,
        );
        assert.include(
          text,
          "ContactRepository.insert failed (UniqueViolation)",
        );
        assert.notInclude(text, "Hopper");
        assert.notInclude(text, "grace@example.org");
        assert.notInclude(text, "private question");
      }),
    );
  });
});
