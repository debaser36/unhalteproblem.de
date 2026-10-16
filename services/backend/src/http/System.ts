import { Api } from "@unhalteproblem.de/api";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

export const SystemHandlers = HttpApiBuilder.group(Api, "system", (handlers) =>
  handlers.handle("health", () => Effect.succeed({ status: "ok" as const })),
);
