import { Api, type Role, Unauthorized } from "@unhalteproblem.de/api";
import { Effect, Layer, Schema } from "effect";
import type {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from "effect/http-api";
import { expect, onTestFinished } from "vitest";
import { Reactivity } from "effect/reactivity";
import { ApiClient } from "#api/ApiClient.ts";
import { sessionWith } from "./fixtures.ts";

type Groups = typeof Api extends HttpApi.HttpApi<string, infer G> ? G : never;

type Endpoints<Group extends HttpApiGroup.Constraint> =
  Group["endpoints"] extends infer E extends Readonly<
    Record<string, HttpApiEndpoint.ConstraintRequest>
  >
    ? E
    : never;

/** What the website's client passes to an endpoint (decoded values). */
export type Request<E extends HttpApiEndpoint.ConstraintRequest> =
  HttpApiEndpoint.ClientRequest<
    E["~Params"],
    E["~Query"],
    E["~Payload"],
    E["~Headers"],
    "decoded-only"
  >;

/**
 * A fake endpoint: receives the request the page sent and answers with the
 * decoded success value or one of the endpoint's declared errors.
 */
export type Handler<E extends HttpApiEndpoint.ConstraintRequest> = (
  request: Request<E>,
) => Effect.Effect<
  HttpApiClient.SuccessType<E["~Success"]>,
  E["~Error"]["Type"] | HttpApiMiddleware.Error<E["~Middleware"]>
>;

/**
 * Fakes for some endpoints of the contract, by group and endpoint name.
 * Changing the contract breaks the fakes that no longer match at compile
 * time, like it breaks the pages.
 */
export type Handlers = {
  readonly [G in Groups as HttpApiGroup.Identifier<G>]?: {
    readonly [K in keyof Endpoints<G>]?: Handler<Endpoints<G>[K]>;
  };
};

/** One request a page sent, in the order they were sent. */
export interface Call {
  readonly group: string;
  readonly endpoint: string;
  readonly request: unknown;
}

type RequestOf<H> = H extends (request: infer R) => unknown ? R : never;

export interface FakeApi {
  /** Requests sent so far; assert on these to check what a page submitted. */
  readonly calls: Array<Call>;
  /** The `ApiClient` runtime layer, for `RegistryProvider`'s initial values. */
  readonly layer: Layer.Layer<ApiClient | Reactivity.Reactivity>;
  /** The requests sent to one endpoint. */
  readonly callsTo: <
    G extends keyof Handlers & string,
    K extends keyof NonNullable<Handlers[G]> & string,
  >(
    group: G,
    endpoint: K,
  ) => Array<RequestOf<NonNullable<Handlers[G]>[K]>>;
}

// The client also passes its own options (response mode, reactivity keys);
// keep only what the page sent.
const requestOf = (options: Record<string, unknown> | undefined) =>
  Object.fromEntries(
    ["params", "query", "payload", "headers"].flatMap((key) =>
      options?.[key] === undefined ? [] : [[key, options[key]]],
    ),
  );

export interface FakeApiOptions {
  /**
   * Logs in the test user with these roles (`auth.session`); nobody is
   * logged in without it.
   */
  readonly roles?: ReadonlyArray<Role>;
}

/**
 * An in-memory backend for component tests: the `ApiClient` answers from
 * `handlers` instead of the network. Requests and answers go through the
 * contract's schemas like on the wire. An endpoint the page calls without a
 * handler dies with "unhandled endpoint" and fails the test.
 */
export const fakeApi = (
  handlers: Handlers = {},
  options: FakeApiOptions = {},
): FakeApi => {
  const calls: Array<Call> = [];
  const session: Handlers = {
    auth: {
      session: () =>
        options.roles === undefined
          ? Effect.fail(new Unauthorized())
          : Effect.succeed(sessionWith(options.roles)),
    },
  };
  const lookup = (group: string, endpoint: string) => {
    const pick = (from: Handlers) =>
      (from as Record<string, Record<string, unknown> | undefined>)[group]?.[
        endpoint
      ] as ((request: unknown) => Effect.Effect<unknown, unknown>) | undefined;
    return pick(handlers) ?? pick(session);
  };

  // A test that hits an endpoint without a handler fails even when the page
  // shows the resulting defect like a real error.
  const unhandled: Array<string> = [];
  onTestFinished(() => {
    expect(unhandled, "endpoints called without a handler").toEqual([]);
  });

  const endpointClient =
    (group: string, endpoint: string) =>
    (options: Record<string, unknown> | undefined) => {
      const mode = options?.["responseMode"];
      if (mode !== undefined && mode !== "decoded-only") {
        return Effect.die(
          new Error(`fakeApi: ${String(mode)} is not supported`),
        );
      }
      const definition = groups[group]?.endpoints[endpoint];
      const handler = lookup(group, endpoint);
      if (definition === undefined || handler === undefined) {
        unhandled.push(`${group}.${endpoint}`);
        return Effect.die(
          new Error(`fakeApi: unhandled endpoint ${group}.${endpoint}`),
        );
      }
      const request = requestOf(options);
      return Effect.suspend(() => {
        calls.push({ group, endpoint, request });
        return checkRequest(definition, request).pipe(
          Effect.andThen(handler(request)),
          Effect.tap(checkResponse(definition)),
        );
      });
    };

  const groupClient = (group: string) =>
    new Proxy(
      {},
      {
        get: (_, endpoint) =>
          typeof endpoint === "string"
            ? endpointClient(group, endpoint)
            : undefined,
      },
    );

  const client = new Proxy(
    {},
    {
      get: (_, key) => {
        if (typeof key !== "string") return undefined;
        const topLevelGroup = topLevel.get(key);
        return topLevelGroup === undefined
          ? groupClient(key)
          : endpointClient(topLevelGroup, key);
      },
    },
  ) as ApiClient["Service"];

  return {
    calls,
    // This replaces the whole runtime layer, global layers included.
    // Mutations still invalidate the queries because `Reactivity.layer` is
    // the very layer the atoms' reactivity is built from (one instance per
    // registry), so it must stay this exact reference.
    layer: Layer.provideMerge(
      Layer.succeed(ApiClient, client),
      Reactivity.layer,
    ),
    // Recorded as the handlers received them, so typed like their argument.
    callsTo: ((group: string, endpoint: string) =>
      calls
        .filter((call) => call.group === group && call.endpoint === endpoint)
        .map((call) => call.request)) as FakeApi["callsTo"],
  };
};

const groups = Api.groups as unknown as Record<string, HttpApiGroup.Top>;

/** Endpoints of `topLevel` groups sit on the client itself, not a group. */
const topLevel = new Map(
  Object.values(groups).flatMap((group) =>
    group.topLevel
      ? Object.keys(group.endpoints).map((name) => [name, group.identifier])
      : [],
  ),
);

/**
 * Encodes the request as the real client does before sending it, so a page
 * sending what the contract refuses (too long, wrong format) fails the test
 * with a defect, as it fails in production. Uploads (`FormData`) pass.
 */
const checkRequest = (
  definition: HttpApiEndpoint.Top,
  request: Record<string, unknown>,
) => {
  const payloads = [...definition.payload.values()].flatMap(
    ({ schemas }) => schemas,
  );
  const parts: Array<readonly [Schema.Top | undefined, unknown]> = [
    [definition.params, request["params"]],
    [definition.query, request["query"]],
    [definition.headers, request["headers"]],
    [
      payloads.length === 0 || request["payload"] instanceof FormData
        ? undefined
        : Schema.Union(payloads),
      request["payload"],
    ],
  ];
  return Effect.forEach(
    parts,
    ([schema, value]) =>
      schema === undefined || value === undefined
        ? Effect.void
        : Schema.encodeUnknownEffect(schema)(value),
    { discard: true },
  ).pipe(Effect.orDie);
};

/**
 * Sends the handler's answer through the success schemas like the wire
 * would, so a fixture the contract can't encode fails the test.
 */
const checkResponse = (definition: HttpApiEndpoint.Top) => (value: unknown) => {
  const schemas = [...definition.success];
  return schemas.length === 0
    ? Effect.void
    : Schema.encodeUnknownEffect(Schema.Union(schemas))(value).pipe(
        Effect.orDie,
      );
};
