import { Authorized } from "@unhalteproblem.de/api";
import { Context, type DateTime, Effect, Layer, Option } from "effect";
import * as Query from "#cqrs/Query";
import type { ContactMessageId, StoredContactMessage } from "./Contact.ts";
import { ContactRepository } from "./ContactRepository.ts";

export interface ContactPosition {
  readonly createdAt: DateTime.Utc;
  readonly id: ContactMessageId;
}

export interface ContactPage {
  readonly messages: ReadonlyArray<StoredContactMessage>;
  /** Where the next page starts; none on the last page. */
  readonly next: Option.Option<ContactPosition>;
}

const make = Effect.gen(function* () {
  const repository = yield* ContactRepository;
  return ContactQueries.of({
    page: Effect.fn("ContactQueries.page")(function* (query: {
      readonly limit: number;
      readonly after: Option.Option<ContactPosition>;
    }) {
      yield* Authorized("admin");
      // One more than asked tells whether there is a next page.
      const rows = yield* repository.page({ ...query, limit: query.limit + 1 });
      const messages = rows.slice(0, query.limit);
      const last = messages.at(-1);
      return {
        messages,
        next:
          rows.length > query.limit && last !== undefined
            ? Option.some({ createdAt: last.createdAt, id: last.id })
            : Option.none(),
      } satisfies ContactPage;
    }, Query.boundary),
  });
});

/**
 * Reading stored contact messages, for admins (the owner also gets each by
 * mail). Personal data: nothing here logs it.
 *
 * @effect-expect-leaking Authorized<"admin">
 */
export class ContactQueries extends Context.Service<
  ContactQueries,
  {
    readonly page: (query: {
      readonly limit: number;
      readonly after: Option.Option<ContactPosition>;
    }) => Effect.Effect<ContactPage, never, Authorized<"admin">>;
  }
>()("@unhalteproblem.de/backend/domains/contact/ContactQueries") {
  /** Needs `ContactRepository`. */
  static readonly layer = Layer.effect(ContactQueries, make);
}
