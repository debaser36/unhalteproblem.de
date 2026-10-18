import { NodeHttpServer } from "@effect/platform-node";
import { Api, RequireAdmin, RequireSuperAdmin } from "@unhalteproblem.de/api";
import { ByteSize, Effect, Layer, Logger } from "effect";
import { HttpIncomingMessage, HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { createServer } from "node:http";
import * as Authorization from "#auth/Authorization";
import { LogFormat, ServerConfig } from "#Config";
import { DomainsLive } from "#domains/Domains";
import { AdminHandlers } from "#http/Admin";
import { AuthHandlers } from "#http/Auth";
import { AuthenticationLive } from "#http/Authentication";
import { ContactHandlers } from "#http/Contact";
import { SameOriginLive } from "#http/SameOrigin";
import { SystemHandlers } from "#http/System";
import { LoginAttempts } from "#repositories/LoginAttempts";
import { LogoutTokens } from "#repositories/LogoutTokens";
import { Sessions } from "#repositories/Sessions";
import { AuthCleanup } from "#services/AuthCleanup";
import { ContactDelivery } from "#services/ContactDelivery";
import { ContactRateLimit } from "#services/ContactRateLimit";
import { DatabaseLive } from "#services/Database";
import { LoginRateLimit } from "#services/LoginRateLimit";
import { OidcProvider } from "#services/OidcProvider";
import { TokenVerifier } from "#services/TokenVerifier";

// One database pool (and one migration run) shared by all repositories and
// domains. The users domain ends sessions when it restricts a user.
const Repositories = Layer.mergeAll(
  LoginAttempts.layer,
  LogoutTokens.layer,
  DomainsLive.pipe(Layer.provideMerge(Sessions.layer)),
).pipe(Layer.provideMerge(DatabaseLive));

const AuthServices = Layer.mergeAll(
  AuthenticationLive,
  SameOriginLive,
  Authorization.middleware(RequireAdmin),
  Authorization.middleware(RequireSuperAdmin),
  OidcProvider.layer,
  TokenVerifier.layer,
  AuthCleanup,
  LoginRateLimit.layer,
).pipe(Layer.provideMerge(Repositories));

const Handlers = Layer.mergeAll(
  SystemHandlers,
  ContactHandlers,
  AuthHandlers,
  AdminHandlers,
).pipe(
  Layer.provide([ContactDelivery.layerLog, ContactRateLimit.layer]),
  Layer.provideMerge(AuthServices),
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
