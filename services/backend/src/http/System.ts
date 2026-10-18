import { Api, ServiceUnavailable } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Readiness } from "#services/Readiness";

export const SystemHandlers = HttpApiBuilder.group(
  Api,
  "system",
  Effect.fn(function* (handlers) {
    const readiness = yield* Readiness;
    return handlers
      .handle("health", () => Effect.succeed({ status: "ok" as const }))
      .handle("ready", () =>
        readiness.check.pipe(
          Effect.as({ status: "ready" as const }),
          Effect.catchTag("NotReady", () =>
            Effect.fail(new ServiceUnavailable()),
          ),
        ),
      );
  }),
);
