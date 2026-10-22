import { NodeHttpServer } from "@effect/platform-node";
import {
  Api,
  RequireAdmin,
  RequireBlogRequestModerator,
  RequireFoodPlanner,
  RequireSuperAdmin,
} from "@unhalteproblem.de/api";
import { ByteSize, Effect, Layer, Logger, References } from "effect";
import { HttpIncomingMessage, HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { createServer } from "node:http";
import * as Authorization from "#auth/Authorization";
import { LogFormat, LogLevelConfig, ServerConfig } from "#Config";
import { DomainsLive } from "#domains/Domains";
import { AdminHandlers } from "#http/Admin";
import { AdminInsightsHandlers } from "#http/AdminInsights";
import { AccountHandlers } from "#http/Account";
import { AuthHandlers } from "#http/Auth";
import { AuthenticationLive } from "#http/Authentication";
import { BlogEditorHandlers } from "#http/BlogEditor";
import {
  BlogRequestAdminHandlers,
  BlogRequestsHandlers,
} from "#http/BlogRequests";
import { BlogsHandlers } from "#http/Blogs";
import { ContactHandlers } from "#http/Contact";
import { FoodPlannerHandlers } from "#http/Food";
import { LargeBodyLive } from "#http/LargeBody";
import { MediaHandlers } from "#http/Media";
import { ProjectAdminHandlers } from "#http/ProjectAdmin";
import { ProjectsHandlers } from "#http/Projects";
import { RequestLogging } from "#http/RequestLogging";
import { SameOriginLive } from "#http/SameOrigin";
import { SeoHandlers } from "#http/Seo";
import { SystemHandlers } from "#http/System";
import { LoginAttempts } from "#auth/LoginAttempts";
import { LogoutTokens } from "#auth/LogoutTokens";
import { Sessions } from "#auth/Sessions";
import { AuthCleanup } from "#auth/AuthCleanup";
import { ContactRateLimit } from "#domains/contact/ContactRateLimit";
import { DatabaseLive } from "#infrastructure/Database";
import { Claude } from "#infrastructure/Claude";
import { KeycloakAdmin } from "#infrastructure/KeycloakAdmin";
import { LoginRateLimit } from "#auth/LoginRateLimit";
import { Mailer } from "#infrastructure/Mailer";
import { OpenFoodFacts } from "#infrastructure/OpenFoodFacts";
import { OpenPrices } from "#infrastructure/OpenPrices";
import { StatsNz } from "#infrastructure/StatsNz";
import { OidcProvider } from "#auth/OidcProvider";
import { Readiness } from "#infrastructure/Readiness";
import { TokenVerifier } from "#auth/TokenVerifier";

// One database pool (and one migration run) shared by all repositories and
// domains. The users domain ends sessions when it restricts a user.
const Repositories = Layer.mergeAll(
  LoginAttempts.layer,
  LogoutTokens.layer,
  DomainsLive.pipe(
    Layer.provide([
      Mailer.layer,
      KeycloakAdmin.layer,
      OpenPrices.layer,
      OpenFoodFacts.layer,
      StatsNz.layer,
      Claude.layer,
    ]),
    Layer.provideMerge(Sessions.layer),
  ),
).pipe(Layer.provideMerge(DatabaseLive));

const AuthServices = Layer.mergeAll(
  AuthenticationLive,
  SameOriginLive,
  LargeBodyLive,
  Authorization.blogEditorMiddleware,
  Authorization.middleware(RequireAdmin),
  Authorization.middleware(RequireSuperAdmin),
  Authorization.middleware(RequireBlogRequestModerator),
  Authorization.middleware(RequireFoodPlanner),
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
  AdminInsightsHandlers,
  AccountHandlers,
  BlogsHandlers,
  BlogEditorHandlers,
  BlogRequestsHandlers,
  BlogRequestAdminHandlers,
  MediaHandlers,
  ProjectsHandlers,
  ProjectAdminHandlers,
  SeoHandlers,
  FoodPlannerHandlers,
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
