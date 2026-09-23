import * as t from "typebox";

/**
 * Shared helpers for plugins that talk to the Shift cloud API
 * (shiftWork, shiftPages, shiftTranscription, shiftObjects, shiftCrm,
 * shiftOcr, shiftAtlas). One base URL, one bearer-auth request helper,
 * and the common TypeBox schema builders.
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

const SHIFT_API_URL = "https://cloud.shift-labs.ai";

export function baseUrl(): string {
  return `${SHIFT_API_URL}/`;
}

export async function request<T>(
  ctx: Ctx,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const apiKey = ctx.connection.config.apiKey;
  if (typeof apiKey !== "string" || !apiKey) {
    throw new Error("Shift Labs apiKey is required");
  }
  headers.set("authorization", `Bearer ${apiKey}`);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(new URL(path, baseUrl()), {
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
