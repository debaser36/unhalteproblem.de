import { Api, RateLimited } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { ContactDelivery } from "#services/ContactDelivery";
import { ContactRateLimit } from "#services/ContactRateLimit";
import { clientKey } from "./ClientIp.ts";

export const ContactHandlers = HttpApiBuilder.group(
  Api,
  "contact",
  Effect.fn(function* (handlers) {
    const delivery = yield* ContactDelivery;
    const rateLimit = yield* ContactRateLimit;
    return handlers.handle("submit", ({ payload, request }) =>
      rateLimit.consume(clientKey(request)).pipe(
        Effect.catchTag("ContactRateLimitExceeded", () =>
          Effect.fail(new RateLimited()),
        ),
        Effect.andThen(delivery.deliver(payload)),
      ),
    );
  }),
);
