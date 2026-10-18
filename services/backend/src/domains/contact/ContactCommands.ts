import { type ContactMessage } from "@unhalteproblem.de/api";
import { Context, DateTime, type Duration, Effect, Layer } from "effect";
import * as Command from "#cqrs/Command";
import * as DomainEvent from "#cqrs/DomainEvent";
import { Outbox } from "#cqrs/Outbox";
import { Transaction } from "#cqrs/Transaction";
import {
  ContactMessageId,
  ContactMessageReceived,
  retentionCutoff,
  SendContactMail,
  StoredContactMessage,
} from "./Contact.ts";
import { ContactRepository } from "./ContactRepository.ts";

const make = Effect.gen(function* () {
  const repository = yield* ContactRepository;
  const outbox = yield* Outbox;
  const transaction = yield* Transaction;

  return ContactCommands.of({
    submit: Effect.fn("ContactCommands.submit")(function* (
      message: ContactMessage,
    ) {
      const id = ContactMessageId.make(crypto.randomUUID());
      const now = yield* DateTime.now;
      yield* repository.insert(
        new StoredContactMessage({ id, ...message, createdAt: now }),
      );
      // In the same transaction: the mail is promised exactly when the
      // message is stored.
      yield* outbox.enqueue(SendContactMail, { messageId: id });
      yield* DomainEvent.record(new ContactMessageReceived({ messageId: id }));
    }, Command.boundary(transaction)),

    purgeOlderThan: Effect.fn("ContactCommands.purgeOlderThan")(function* (
      retention: Duration.Input,
    ) {
      const now = yield* DateTime.now;
      return yield* repository.deleteCreatedBefore(
        retentionCutoff(now, retention),
      );
    }, Command.boundary(transaction)),
  });
});

/** The commands of the contact domain: everything that changes stored messages. */
export class ContactCommands extends Context.Service<
  ContactCommands,
  {
    /**
     * Stores a message from the contact form and promises a mail about it
     * (outbox), atomically. Records `ContactMessageReceived`.
     */
    readonly submit: (message: ContactMessage) => Effect.Effect<void>;
    /** Deletes the messages stored longer than `retention` ago; returns how many. */
    readonly purgeOlderThan: (
      retention: Duration.Input,
    ) => Effect.Effect<number>;
  }
>()("@unhalteproblem.de/backend/domains/contact/ContactCommands") {
  /** Needs `ContactRepository`, `Outbox` and `Transaction`. */
  static readonly layer = Layer.effect(ContactCommands, make);
}
