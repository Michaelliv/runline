import * as t from "typebox";
import { authedFetch } from "./authedFetch.js";
import { readBounded } from "./provider.js";

/**
 * Shared helpers for plugins that talk to the Shift cloud API
 * (shiftWork, shiftPages, shiftTranscription, shiftObjects, shiftCrm,
 * shiftBwm, shiftOcr, shiftAtlas). One base URL, one bearer-auth
 * transport, and the common TypeBox schema builders.
 */

export type Ctx = { connection: { config: Record<string, unknown> } };

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

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/**
 * The transport for every request carrying a Shift API key. Redirects are
 * refused so the key never reaches another host; one deadline covers the
 * whole exchange including the body; the body is read with a ceiling and
 * returned buffered, so callers consume it as usual.
 */
export async function shiftFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const response = await authedFetch(input, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

export async function request<T>(
  ctx: Ctx,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiKey(ctx)}`);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await shiftFetch(new URL(path, baseUrl()), {
    ...init,
    headers,
  });
  if (!response.ok) {
    throw new Error(
      `Shift Labs API error ${response.status}: ${await response.text()}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function pathSegment(value: string): string {
  return encodeURIComponent(value);
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
