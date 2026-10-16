import type { ContactMessage } from "@unhalteproblem.de/api";
import { Context, Effect, Layer } from "effect";

/** Hands an accepted contact message on to whoever should read it. */
export class ContactDelivery extends Context.Service<
  ContactDelivery,
  {
    readonly deliver: (message: ContactMessage) => Effect.Effect<void>;
  }
>()("@unhalteproblem.de/backend/ContactDelivery") {
  /**
   * Log-only delivery for now: the message ends up in the service log. Mail
   * or database delivery replaces this layer later without touching the
   * handlers.
   */
  static readonly layerLog = Layer.succeed(
    ContactDelivery,
    ContactDelivery.of({
      deliver: Effect.fn("ContactDelivery.deliver")(function* (
        message: ContactMessage,
      ) {
        yield* Effect.logInfo("Contact message received").pipe(
          Effect.annotateLogs({
            "contact.name": message.name,
            "contact.email": message.email,
            "contact.message": message.message,
          }),
        );
      }),
    }),
  );
}
