import { Api, RateLimited } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { ContactCommands } from "#domains/contact/ContactCommands";
import { ContactRateLimit } from "#services/ContactRateLimit";
import { clientKey } from "./ClientIp.ts";

export const ContactHandlers = HttpApiBuilder.group(
  Api,
  "contact",
  Effect.fn(function* (handlers) {
    const commands = yield* ContactCommands;
    const rateLimit = yield* ContactRateLimit;
    return handlers.handle("submit", ({ payload, request }) =>
      rateLimit.consume(clientKey(request)).pipe(
        Effect.catchTag("ContactRateLimitExceeded", () =>
          Effect.fail(new RateLimited()),
        ),
        Effect.andThen(commands.submit(payload)),
      ),
    );
  }),
);
