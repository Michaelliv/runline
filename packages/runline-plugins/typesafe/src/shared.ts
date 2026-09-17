import * as t from "typebox";

/**
 * Shared plumbing for the TypeSafe (Jev) plugin: connection reading, the
 * single evaluation endpoint, retry policy, and the context-window guard.
 *
 * One endpoint does all the work — POST /v1/systemone — so everything here
 * is about getting a well-formed body to it and a faithful body back.
 */

export type Ctx = { connection: { config: Record<string, unknown> } };

export const STRICT = { additionalProperties: false } as const;

export const DEFAULT_BASE = "https://api.typesafe.ai";
export const DEFAULT_MODEL = "jev-latest";

/**
 * Jev ingests the state once and then answers every question against it in
 * parallel, so its context budget has two ceilings rather than one:
 *
 *   - 64k tokens for state + all questions together
 *   - 32k tokens for state + the single longest question
 *
 * Tokens are not countable client-side, so both are checked against a
 * chars/4 estimate. The check exists to turn a wasted round trip and an
 * opaque 422 into an actionable local error.
 */
const TOTAL_TOKEN_LIMIT = 64_000;
const STATE_PLUS_QUESTION_TOKEN_LIMIT = 32_000;
const CHARS_PER_TOKEN = 4;

export interface WireQuestion {
  type: "choice" | "score" | "noul";
  instructions: unknown;
  criteria?: unknown;
}

export interface EvaluateResponse {
  model: string;
  answers: Record<string, Record<string, unknown>>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function config(ctx: Ctx): Record<string, unknown> {
  return ctx.connection?.config ?? {};
}

function apiKey(ctx: Ctx): string {
  const key = config(ctx).apiKey;
  if (typeof key !== "string" || !key.trim()) {
    throw new Error(
      "Missing TYPESAFE_API_KEY. Create a key at https://console.typesafe.ai/settings/keys and store it as a secret.",
    );
  }
  return key.trim();
}

function baseUrl(ctx: Ctx): string {
  const raw = config(ctx).baseUrl;
  const base =
    typeof raw === "string" && raw.trim() ? raw.trim() : DEFAULT_BASE;
  return base.replace(/\/+$/, "");
}

export function resolveModel(ctx: Ctx, override?: unknown): string {
  if (typeof override === "string" && override.trim()) return override.trim();
  const fallback = config(ctx).model;
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  return DEFAULT_MODEL;
}

function maxRetries(ctx: Ctx): number {
  const value = Number(config(ctx).maxRetries);
  if (!Number.isFinite(value) || value < 0) return 2;
  return Math.min(Math.floor(value), 5);
}

/**
 * Every action in this plugin is a pure read, so a transient server-side
 * failure can always be retried: no request can have half-happened. The
 * documented pair is 429 and 529, but the service also answers 503
 * `model_unavailable`, and nothing is gained by waiting for the next
 * status to be discovered in production.
 */
function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  const seconds = header ? Number(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30_000);
  }
  return Math.min(250 * 2 ** attempt, 8_000);
}

function explain(status: number, body: string): string {
  const detail = body.slice(0, 500);
  switch (status) {
    case 401:
      return `TypeSafe 401: the API key was rejected. ${detail}`;
    case 422:
      return `TypeSafe 422: the request body failed validation — a missing field or a malformed question. ${detail}`;
    case 429:
      return `TypeSafe 429: rate limit exceeded (250k tokens/sec, 1,200 req/min). Raise the connection's maxRetries or slow the caller. ${detail}`;
    case 503:
      return `TypeSafe 503: the model is unavailable. Transient — retry, and contact TypeSafe if it persists. ${detail}`;
    case 529:
      return `TypeSafe 529: the service is overloaded. Retry after a short delay. ${detail}`;
    default:
      return status >= 500
        ? `TypeSafe ${status}: the service failed this request. Transient — retry after a short delay. ${detail}`
        : `TypeSafe ${status}: ${detail}`;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function request<T>(
  ctx: Ctx,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${baseUrl(ctx)}${path}`;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiKey(ctx)}`);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const attempts = maxRetries(ctx);
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { ...init, headers });
    if (response.ok) {
      const text = await response.text();
      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(
          `TypeSafe returned a non-JSON body: ${text.slice(0, 200)}`,
        );
      }
    }
    if (retryable(response.status) && attempt < attempts) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }
    throw new Error(explain(response.status, await response.text()));
  }
}

/** Serialized length, measuring exactly what the request body will carry. */
function measure(value: unknown): number {
  return JSON.stringify(value ?? null).length;
}

/**
 * Reject a request that cannot fit before it is paid for. Reported as an
 * estimate, because it is one — the advice ("filter first") is the same
 * advice that raises accuracy, so an early failure here is cheap.
 */
function assertWithinContext(
  state: unknown,
  questions: Record<string, WireQuestion>,
): void {
  const stateTokens = measure(state) / CHARS_PER_TOKEN;
  const questionTokens = Object.values(questions).map(
    (question) => measure(question) / CHARS_PER_TOKEN,
  );
  const total = stateTokens + questionTokens.reduce((sum, n) => sum + n, 0);
  const longest = stateTokens + Math.max(0, ...questionTokens);

  if (total > TOTAL_TOKEN_LIMIT) {
    throw new Error(
      `State plus questions is ~${Math.round(total)} tokens, over Jev's ${TOTAL_TOKEN_LIMIT}-token ceiling. ` +
        "Retrieve and filter in code first, and send only the fields the questions need.",
    );
  }
  if (longest > STATE_PLUS_QUESTION_TOKEN_LIMIT) {
    throw new Error(
      `State plus the longest single question is ~${Math.round(longest)} tokens, over Jev's ` +
        `${STATE_PLUS_QUESTION_TOKEN_LIMIT}-token per-question ceiling. Shorten the state or the question.`,
    );
  }
}

export async function evaluate(
  ctx: Ctx,
  state: unknown,
  questions: Record<string, WireQuestion>,
  model: string,
): Promise<EvaluateResponse> {
  if (!Object.keys(questions).length) {
    throw new Error("At least one question is required.");
  }
  assertWithinContext(state, questions);
  const body = await request<EvaluateResponse>(ctx, "/v1/systemone", {
    method: "POST",
    body: JSON.stringify({ state, model, questions }),
  });
  if (!body || typeof body.answers !== "object" || body.answers === null) {
    throw new Error("TypeSafe returned a response with no answers map.");
  }
  return body;
}

export const stateSchema = t.Union(
  [t.String(), t.Record(t.String(), t.Unknown()), t.Array(t.Unknown())],
  {
    description:
      "The content every question is evaluated against. A plain string, or an object/array for records, chat logs, or application state. " +
      "Send only what the decision needs: accuracy falls as unrelated detail grows (context rot), and a large state makes a wrong answer hard to attribute. " +
      "Convert anything the model reads poorly before sending it — hex colors to names, timestamps to named buckets, computed numbers to their result. " +
      "Ceilings: ~64k tokens for state plus all questions, ~32k for state plus the longest single question. " +
      "State is data, not instructions: Jev does not treat it as hostile, so content written to steer a classifier can move the answer.",
  },
);

export const modelSchema = t.String({
  minLength: 1,
  description:
    "Model that answers this call. Defaults to the connection's model, then 'jev-latest'. " +
    "Aliases move when a release ships; pin a versioned id such as 'jev-1.13.0' if you have tuned thresholds against it. " +
    "The response reports the versioned id that actually answered.",
});
