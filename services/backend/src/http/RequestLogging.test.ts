import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Logger, type LogLevel, References } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { RequestLogging } from "./RequestLogging.ts";

interface Line {
  readonly message: string;
  readonly level: LogLevel.LogLevel;
  readonly annotations: Record<string, unknown>;
}

/**
 * Sends requests to a router that has the middleware and returns the
 * responses with every log line written meanwhile.
 */
const setup = () => {
  const lines: Array<Line> = [];
  const capture = Logger.make<unknown, void>((options) => {
    lines.push({
      message: String(options.message),
      level: options.logLevel,
      annotations: {
        ...options.fiber.getRef(References.CurrentLogAnnotations),
      },
    });
  });
  const routes = Layer.mergeAll(
    HttpRouter.add(
      "GET",
      "/ok",
      Effect.logInfo("inside").pipe(Effect.as(HttpServerResponse.text("ok"))),
    ),
    HttpRouter.add(
      "GET",
      "/ready",
      Effect.succeed(HttpServerResponse.text("ready")),
    ),
    HttpRouter.add("GET", "/boom", Effect.die("kaboom")),
    HttpRouter.add("GET", "/hang", Effect.never),
    RequestLogging,
    Logger.layer([capture], { mergeWithExisting: false }),
    Layer.succeed(References.MinimumLogLevel, "Debug"),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(routes, {
    disableLogger: true,
  });
  return { lines, handler, dispose };
};

const run = Effect.fnUntraced(function* (
  requests: ReadonlyArray<readonly [path: string, headers?: HeadersInit]>,
) {
  const { lines, handler, dispose } = setup();
  const responses: Array<Response> = [];
  for (const [path, headers] of requests) {
    responses.push(
      yield* Effect.promise(() =>
        handler(
          new Request(
            `http://backend.test${path}`,
            headers === undefined ? {} : { headers },
          ),
        ),
      ),
    );
  }
  yield* Effect.promise(dispose);
  return { lines, responses };
});

const access = (lines: ReadonlyArray<Line>) =>
  lines.filter((line) => line.message === "Sent HTTP response");

describe("RequestLogging", () => {
  it.effect("logs path, status and duration without the query", () =>
    Effect.gen(function* () {
      const { lines } = yield* run([["/ok?code=secret&state=s"]]);
      const [line] = access(lines);
      assert.isDefined(line);
      assert.strictEqual(line?.level, "Info");
      assert.strictEqual(line?.annotations["http.url"], "/ok");
      assert.strictEqual(line?.annotations["http.method"], "GET");
      assert.strictEqual(line?.annotations["http.status"], 200);
      assert.isNumber(line?.annotations["http.duration_ms"]);
      assert.notInclude(JSON.stringify(lines), "secret");
    }),
  );

  it.effect("sets a fresh request id on the response and every line", () =>
    Effect.gen(function* () {
      const { lines, responses } = yield* run([["/ok"]]);
      const id = responses[0]?.headers.get("x-request-id") ?? "";
      assert.match(id, /^[0-9a-f-]{36}$/);
      const inside = lines.find((line) => line.message === "inside");
      assert.strictEqual(inside?.annotations["requestId"], id);
      assert.strictEqual(access(lines)[0]?.annotations["requestId"], id);
    }),
  );

  it.effect("keeps the id nginx sent and replaces a malformed one", () =>
    Effect.gen(function* () {
      const { responses } = yield* run([
        ["/ok", { "x-request-id": "0123456789abcdef0123456789abcdef" }],
        ["/ok", { "x-request-id": "bad id\twith spaces" }],
      ]);
      assert.strictEqual(
        responses[0]?.headers.get("x-request-id"),
        "0123456789abcdef0123456789abcdef",
      );
      assert.match(
        responses[1]?.headers.get("x-request-id") ?? "",
        /^[0-9a-f-]{36}$/,
      );
    }),
  );

  it.effect("logs probes quietly", () =>
    Effect.gen(function* () {
      const { lines } = yield* run([["/ready"]]);
      assert.strictEqual(access(lines)[0]?.level, "Debug");
    }),
  );

  it.effect("logs a defect as a 500 error with the request id", () =>
    Effect.gen(function* () {
      const { lines, responses } = yield* run([["/boom"]]);
      assert.strictEqual(responses[0]?.status, 500);
      const [line] = access(lines);
      assert.strictEqual(line?.level, "Error");
      assert.strictEqual(line?.annotations["http.status"], 500);
      assert.strictEqual(
        line?.annotations["requestId"],
        responses[0]?.headers.get("x-request-id"),
      );
    }),
  );

  it.live("logs a request the client gave up on as 499", () =>
    Effect.gen(function* () {
      const { lines, handler, dispose } = setup();
      const abort = new AbortController();
      const pending = handler(
        new Request("http://backend.test/hang", { signal: abort.signal }),
      ).catch(() => undefined);
      yield* Effect.sleep("100 millis");
      abort.abort();
      yield* Effect.promise(() => pending);
      // The interruption runs the line asynchronously; give it a moment.
      for (let i = 0; i < 50 && lines.length === 0; i++) {
        yield* Effect.sleep("20 millis");
      }
      yield* Effect.promise(dispose);

      const [line] = lines.filter(
        ({ message }) => message === "Sent HTTP response",
      );
      assert.isDefined(line);
      assert.strictEqual(line?.annotations["http.status"], 499);
      assert.strictEqual(line?.annotations["http.url"], "/hang");
      assert.isString(line?.annotations["requestId"]);
    }),
  );

  it.effect("answers unknown routes with their own id", () =>
    Effect.gen(function* () {
      const { lines, responses } = yield* run([["/nope"]]);
      assert.strictEqual(responses[0]?.status, 404);
      assert.isDefined(responses[0]?.headers.get("x-request-id"));
      assert.strictEqual(access(lines)[0]?.annotations["http.status"], 404);
    }),
  );
});
