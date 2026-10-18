import { randomUUID } from "node:crypto";
import { Cause, Clock, Effect, Exit } from "effect";
import {
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { clientKey } from "./ClientIp.ts";

// nginx sets `X-Request-Id` to its own `$request_id`, so the proxy's access
// log and ours name a request the same way. Anything else a client sends is
// replaced, because the value ends up in logs and in a response header.
const requestIdPattern = /^[A-Za-z0-9._-]{8,64}$/;

// Probes run all day; their lines go to the debug level.
const quietPaths = new Set(["/health", "/ready"]);

/**
 * Gives every request an id, and logs it when it ends.
 *
 * - The id is `X-Request-Id` from the proxy when it looks like one, else a
 *   fresh UUID. It is on the response as `X-Request-Id` and annotates every
 *   log line written while the request runs, so one request can be followed
 *   through the log.
 * - The access log line carries method, path (never the query: it holds OIDC
 *   codes and state), status, duration and the rate-limit key of the client
 *   (IPv6 addresses truncated to the /64 prefix). Server errors are logged
 *   at error level with their cause.
 *
 * Replaces the router's own logger, which has neither id nor duration.
 */
export const RequestLogging = HttpRouter.middleware(
  (httpApp) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const header = request.headers["x-request-id"];
      const requestId =
        header !== undefined && requestIdPattern.test(header)
          ? header
          : randomUUID();
      const path = request.url.split(/[?#]/, 1)[0] ?? request.url;
      const start = yield* Clock.currentTimeMillis;

      const exit = yield* Effect.exit(httpApp).pipe(
        Effect.annotateLogs({ requestId }),
      );

      const [response, cause] = Exit.isSuccess(exit)
        ? [exit.value, undefined]
        : yield* HttpServerError.causeResponse(exit.cause);
      const end = yield* Clock.currentTimeMillis;
      const log = Effect.annotateLogs(
        response.status >= 500
          ? Effect.logError("Sent HTTP response", cause)
          : quietPaths.has(path)
            ? Effect.logDebug("Sent HTTP response")
            : Effect.logInfo("Sent HTTP response"),
        {
          requestId,
          "http.method": request.method,
          "http.url": path,
          "http.status": response.status,
          "http.duration_ms": end - start,
          "client.key": clientKey(request),
        },
      );
      yield* log;

      // An interrupted request (client gone) has nobody to send anything to.
      if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) {
        return yield* exit;
      }
      return HttpServerResponse.setHeader(response, "x-request-id", requestId);
    }),
  { global: true },
);
