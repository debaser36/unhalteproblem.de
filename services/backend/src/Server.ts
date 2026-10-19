import { NodeHttpServer } from "@effect/platform-node";
import { Api, RequireAdmin, RequireSuperAdmin } from "@unhalteproblem.de/api";
import { ByteSize, Effect, Layer, Logger, References } from "effect";
import { HttpIncomingMessage, HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { createServer } from "node:http";
import * as Authorization from "#auth/Authorization";
import { LogFormat, LogLevelConfig, ServerConfig } from "#Config";
import { DomainsLive } from "#domains/Domains";
import { AdminHandlers } from "#http/Admin";
import { AccountHandlers } from "#http/Account";
import { AuthHandlers } from "#http/Auth";
import { AuthenticationLive } from "#http/Authentication";
import { BlogEditorHandlers } from "#http/BlogEditor";
import { BlogsHandlers } from "#http/Blogs";
import { ContactHandlers } from "#http/Contact";
import { LargeBodyLive } from "#http/LargeBody";
import { MediaHandlers } from "#http/Media";
import { RequestLogging } from "#http/RequestLogging";
import { SameOriginLive } from "#http/SameOrigin";
import { SystemHandlers } from "#http/System";
import { LoginAttempts } from "#repositories/LoginAttempts";
import { LogoutTokens } from "#repositories/LogoutTokens";
import { Sessions } from "#repositories/Sessions";
import { AuthCleanup } from "#services/AuthCleanup";
import { ContactRateLimit } from "#services/ContactRateLimit";
import { DatabaseLive } from "#services/Database";
import { KeycloakAdmin } from "#services/KeycloakAdmin";
import { LoginRateLimit } from "#services/LoginRateLimit";
import { Mailer } from "#services/Mailer";
import { OidcProvider } from "#services/OidcProvider";
import { Readiness } from "#services/Readiness";
import { TokenVerifier } from "#services/TokenVerifier";

// One database pool (and one migration run) shared by all repositories and
// domains. The users domain ends sessions when it restricts a user.
const Repositories = Layer.mergeAll(
  LoginAttempts.layer,
  LogoutTokens.layer,
  DomainsLive.pipe(
    Layer.provide([Mailer.layer, KeycloakAdmin.layer]),
    Layer.provideMerge(Sessions.layer),
  ),
).pipe(Layer.provideMerge(DatabaseLive));

const AuthServices = Layer.mergeAll(
  AuthenticationLive,
  SameOriginLive,
  LargeBodyLive,
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
  AccountHandlers,
  BlogsHandlers,
  BlogEditorHandlers,
  MediaHandlers,
).pipe(
  Layer.provide([ContactRateLimit.layer, Readiness.layer]),
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
    const level = yield* LogLevelConfig;
    return Layer.mergeAll(
      Logger.layer([
        format === "json" ? Logger.consoleJson : Logger.consolePretty(),
      ]),
      Layer.succeed(References.MinimumLogLevel, level),
    );
  }),
);

// The largest valid contact message is about 5.5 KB, so anything much bigger
// is rejected before it is read into memory, independent of nginx. Saving a
// post (`LargeBody`, 512 KiB) and uploading an image (the multipart limits
// of `uploadMedia`, 5 MiB) raise it for their own endpoints only.
const MaxBodySizeLive = Layer.succeed(
  HttpIncomingMessage.MaxBodySize,
  ByteSize.kibibytes(32),
);

// The router's own access log is off: `RequestLogging` writes a richer one.
export const Server = HttpRouter.serve(
  Layer.mergeAll(ApiRoutes, RequestLogging),
  { disableLogger: true },
).pipe(
  Layer.provide([HttpServerLive, MaxBodySizeLive]),
  Layer.provide(LoggerLive),
);
