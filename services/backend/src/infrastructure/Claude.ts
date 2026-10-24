import Anthropic from "@anthropic-ai/sdk";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { ClaudeConfig } from "#Config";

/**
 * Claude did not produce a usable answer. `reason` is a short code for logs
 * and stored failures: `unconfigured` (no API key), `api:<status>`,
 * `transport`, `refusal`, `max_tokens`, `output` (not the requested JSON).
 * Never the response text, which can quote the prompt.
 */
export class ClaudeFailed extends Schema.TaggedError<
  ClaudeFailed,
  { readonly brand: unique symbol }
>()("ClaudeFailed", { reason: Schema.String }) {
  override get message() {
    return `Claude request failed (${this.reason})`;
  }
}

/** One turn of a conversation with Claude. */
export interface Turn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** A request for a JSON answer of a known shape. */
export interface JsonRequest<A> {
  /** Instructions that are the same for every request of a kind (cached). */
  readonly system: string;
  /** The conversation so far, starting and ending with the user. */
  readonly turns: ReadonlyArray<Turn>;
  /**
   * The JSON Schema of the answer, in the subset structured outputs
   * accept: objects list every property in `required` and set
   * `additionalProperties: false`.
   */
  readonly jsonSchema: Record<string, unknown>;
  /** Checks the answer again on our side, and gives it its type. */
  readonly schema: Schema.Codec<A, unknown>;
}

/** An answer, and the model that gave it. */
export interface Answer<A> {
  readonly value: A;
  readonly model: string;
}

/** What `ClaudeConfig` holds. */
export interface ClaudeSettings {
  readonly apiKey: Option.Option<Redacted.Redacted>;
  readonly model: string;
  readonly effort: "low" | "medium" | "high" | "xhigh" | "max";
}

// Plans run to many thousand tokens with thinking; streaming keeps the
// request from timing out, so the ceiling can be generous.
const maxTokens = 64_000;

// `transport`: no connection, so nothing reached Claude. A timeout or an
// error mid-stream (`api:unknown`, `unknown`) may come after Claude worked.
// The timeout class extends the connection error, so it is checked first.
const reasonOf = (error: unknown): string =>
  error instanceof Anthropic.APIConnectionTimeoutError
    ? "timeout"
    : error instanceof Anthropic.APIConnectionError
      ? "transport"
      : error instanceof Anthropic.APIError
        ? `api:${error.status ?? "unknown"}`
        : "unknown";

const make = (settings: ClaudeSettings) => {
  const client = Option.map(
    settings.apiKey,
    (apiKey) => new Anthropic({ apiKey: Redacted.value(apiKey) }),
  );

  return Claude.of({
    model: settings.model,
    configured: Option.isSome(client),

    json: <A>(request: JsonRequest<A>) =>
      Effect.gen(function* () {
        if (Option.isNone(client)) {
          return yield* new ClaudeFailed({ reason: "unconfigured" });
        }
        const message = yield* Effect.tryPromise({
          try: (signal) =>
            client.value.beta.messages
              .stream(
                {
                  model: settings.model,
                  max_tokens: maxTokens,
                  // A declined request is re-run on Anthropic's recommended
                  // fallback model instead of coming back as a refusal.
                  betas: ["server-side-fallback-2026-07-01"],
                  fallbacks: "default",
                  output_config: {
                    effort: settings.effort,
                    format: { type: "json_schema", schema: request.jsonSchema },
                  },
                  system: [
                    {
                      type: "text",
                      text: request.system,
                      cache_control: { type: "ephemeral" },
                    },
                  ],
                  // The first turn carries the bulk (the list of foods) and stays
                  // the same when a plan goes back for corrections: cache it.
                  messages: request.turns.map((turn, index) =>
                    index === 0
                      ? {
                          role: turn.role,
                          content: [
                            {
                              type: "text" as const,
                              text: turn.content,
                              cache_control: { type: "ephemeral" as const },
                            },
                          ],
                        }
                      : { role: turn.role, content: turn.content },
                  ),
                },
                { signal },
              )
              .finalMessage(),
          catch: (error) => new ClaudeFailed({ reason: reasonOf(error) }),
        });
        if (message.stop_reason === "refusal") {
          return yield* new ClaudeFailed({ reason: "refusal" });
        }
        if (message.stop_reason === "max_tokens") {
          return yield* new ClaudeFailed({ reason: "max_tokens" });
        }
        const text = message.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("");
        const parsed = yield* Effect.try({
          try: (): unknown => JSON.parse(text),
          catch: () => new ClaudeFailed({ reason: "output" }),
        });
        yield* Effect.annotateCurrentSpan({
          model: message.model,
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        });
        const value = yield* Schema.decodeUnknownEffect(request.schema)(
          parsed,
        ).pipe(Effect.mapError(() => new ClaudeFailed({ reason: "output" })));
        // With the fallback, another model than the configured one may have
        // answered.
        return { value, model: message.model } satisfies Answer<A>;
      }).pipe(Effect.withSpan("Claude.json")),
  });
};

/**
 * Claude, through Anthropic's API, for answers in a given JSON shape. The
 * food planner uses it to write meal plans and to estimate prices.
 *
 * Without `ANTHROPIC_API_KEY` the service still exists, `configured` is
 * false and every request fails with `ClaudeFailed("unconfigured")`, so
 * the rest of the backend runs without a key.
 */
export class Claude extends Context.Service<
  Claude,
  {
    /** The model requests go to (the fallback model may answer instead). */
    readonly model: string;
    /** Whether an API key is set. */
    readonly configured: boolean;
    readonly json: <A>(
      request: JsonRequest<A>,
    ) => Effect.Effect<Answer<A>, ClaudeFailed>;
  }
>()("@unhalteproblem.de/backend/Claude") {
  /** For tests and special setups. */
  static readonly layerWith = (settings: ClaudeSettings) =>
    Layer.succeed(Claude, make(settings));

  /** From `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` and `CLAUDE_EFFORT`. */
  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      return Claude.layerWith(yield* ClaudeConfig);
    }),
  );
}
