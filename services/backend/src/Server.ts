import { NodeHttpServer } from "@effect/platform-node";
import { Api } from "@unhalteproblem.de/api";
import { ByteSize, Effect, Layer, Logger } from "effect";
import { HttpIncomingMessage, HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { createServer } from "node:http";
import { LogFormat, ServerConfig } from "#Config";
import { ContactHandlers } from "#http/Contact";
import { SystemHandlers } from "#http/System";
import { ContactDelivery } from "#services/ContactDelivery";
import { ContactRateLimit } from "#services/ContactRateLimit";

const Handlers = Layer.mergeAll(SystemHandlers, ContactHandlers).pipe(
  Layer.provide([ContactDelivery.layerLog, ContactRateLimit.layer]),
);

const ApiRoutes = HttpApiBuilder.layer(Api).pipe(Layer.provide(Handlers));

const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const { port, host } = yield* ServerConfig;
    return NodeHttpServer.layer(createServer, { port, host });
  }),
);

const LoggerLive = Layer.unwrap(
  Effect.gen(function* () {
    const format = yield* LogFormat;
    return Logger.layer([
      format === "json" ? Logger.consoleJson : Logger.consolePretty(),
    ]);
  }),
);

// The largest valid contact message is about 5.5 KB, so anything much bigger
// is rejected before it is read into memory, independent of nginx.
const MaxBodySizeLive = Layer.succeed(
  HttpIncomingMessage.MaxBodySize,
  ByteSize.kibibytes(32),
);

export const Server = HttpRouter.serve(ApiRoutes).pipe(
  Layer.provide([HttpServerLive, MaxBodySizeLive]),
  Layer.provide(LoggerLive),
);
