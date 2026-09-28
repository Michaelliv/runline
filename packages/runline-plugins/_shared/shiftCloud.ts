import type { ActionContext } from "runline";
import * as t from "typebox";
import { authedFetch } from "./authedFetch.js";
import { readBounded } from "./provider.js";

export { pathSegment } from "./credentials.js";

/**
 * Shared helpers for plugins that talk to the Shift cloud API: one base
 * URL and the common TypeBox schema builders. Plugins that declare their
 * credential sign through shiftCredentials.ts; `request` and `shiftFetch`
 * here carry the key themselves, for shiftOcr and shiftTranscription, whose
 * long-held requests exceed the credential transport's deadline.
 */

export type Ctx = ActionContext;

export const STRICT_OBJECT = { additionalProperties: false } as const;
export const STRICT_UPDATE_OBJECT = {
  additionalProperties: false,
  minProperties: 2,
} as const;

export function idSchema(description: string) {
  return t.String({ minLength: 1, pattern: "\\S", description });
}

export function cursorSchema(description = "Next-page cursor") {
  return t.String({ minLength: 1, maxLength: 512, description });
}

export function timestampSchema(description: string) {
  return t.String({
    format: "date-time",
    pattern: "Z$",
    description,
  });
}

export function enumDescription(
  name: string,
  values: readonly string[],
): string {
  return `${name}: ${values.join(" | ")}`;
}

export function enumSchema(name: string, values: readonly string[]) {
  return t.Union(
    values.map((value) => t.Literal(value)) as [
      ReturnType<typeof t.Literal>,
      ReturnType<typeof t.Literal>,
    ],
    { description: enumDescription(name, values) },
  );
}

export const SHIFT_API_URL = "https://cloud.shift-labs.ai";

export function baseUrl(): string {
  return `${SHIFT_API_URL}/`;
}

/** Default deadline; endpoints that hold the request open pass their own. */
export const SHIFT_REQUEST_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/**
 * The transport for every request carrying a Shift API key. Redirects are
 * refused so the key never reaches another host; one deadline covers the
 * whole exchange including the body, in place of any caller signal; the
 * text body is read with a ceiling and returned buffered, so JSON and text
 * callers consume it as usual.
 */
export async function shiftFetch(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = SHIFT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const response = await authedFetch(input, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await readBounded(
    response,
    MAX_RESPONSE_BYTES,
    "Shift API response exceeds 16 MiB",
  );
  return new Response(text || null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function apiKey(ctx: Ctx): string {
  const key = ctx.connection.config.apiKey;
  if (typeof key !== "string" || !key) {
    throw new Error("Shift Labs apiKey is required");
  }
  return key;
}

/** A Shift error identifier worth handing back: a plain name, never text. */
export function shiftIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[\w.$-]{1,100}$/.test(value)
    ? value
    : undefined;
}

/**
 * The status, with the service's `code` and the offending `param`. Those
 * name what to correct; the free-text `message` can echo request data and
 * is never part of it.
 */
export function shiftErrorMessage(
  plugin: string,
  status: number,
  code?: string,
  param?: string,
): string {
  const detail = [code, param && `param: ${param}`].filter(Boolean).join(", ");
  return `${plugin}: request failed (HTTP ${status}${detail ? ` ${detail}` : ""})`;
}

/** A failed response, read as a Shift error envelope when it is one. */
export async function shiftError(
  plugin: string,
  response: Response,
): Promise<Error> {
  let code: string | undefined;
  let param: string | undefined;
  try {
    const error = ((await response.json()) as { error?: unknown }).error;
    if (typeof error === "string") code = shiftIdentifier(error);
    else if (error && typeof error === "object") {
      const shaped = error as Record<string, unknown>;
      code = shiftIdentifier(shaped.code) ?? shiftIdentifier(shaped.type);
      param = shiftIdentifier(shaped.param);
    }
  } catch {
    // Not an error envelope: the status alone.
  }
  return new Error(shiftErrorMessage(plugin, response.status, code, param));
}

export async function request<T>(
  ctx: Ctx,
  path: string,
  init: RequestInit = {},
  timeoutMs = SHIFT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiKey(ctx)}`);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await shiftFetch(
    new URL(path, baseUrl()),
    { ...init, headers },
    timeoutMs,
  );
  if (!response.ok) throw await shiftError(ctx.connection.plugin, response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function listParams(input: unknown): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(
    (input ?? {}) as Record<string, unknown>,
  )) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params;
}

export function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
