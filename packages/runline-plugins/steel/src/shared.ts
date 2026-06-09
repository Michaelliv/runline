import * as t from "typebox";

const BASE_URL = "https://api.steel.dev";

export type Ctx = { connection: { config: Record<string, unknown> } };

export function apiKey(ctx: Ctx): string {
  return ctx.connection.config.apiKey as string;
}

export type RequestOptions = {
  method?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
};

export async function api(ctx: Ctx, path: string, options: RequestOptions = {}): Promise<unknown> {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    "steel-api-key": apiKey(ctx),
    ...(options.headers ?? {}),
  };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      body = options.body;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
  }

  const res = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers,
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Steel API error ${res.status}: ${text || res.statusText}`);
  if (!text) return {};
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || text.startsWith("{") || text.startsWith("[")) return JSON.parse(text);
  return text;
}

export function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null));
}

export const LIST_INPUT_SCHEMA = {
  limit: t.Optional(t.Number({ description: "Maximum number of results when supported" })),
  cursor: t.Optional(t.String({ description: "Pagination cursor when supported" })),
} as const;

export const SESSION_OPTIONS_SCHEMA = {
  timeout: t.Optional(t.Number({ description: "Session hard timeout in milliseconds" })),
  inactivityTimeout: t.Optional(t.Number({ description: "Release after this many milliseconds of inactivity" })),
  useProxy: t.Optional(t.Any({ description: "true for Steel managed proxy, or proxy config object" })),
  solveCaptcha: t.Optional(t.Boolean({ description: "Enable CAPTCHA detection/solving" })),
  region: t.Optional(t.String({ description: "Steel region, e.g. lax or iad" })),
  namespace: t.Optional(t.String({ description: "Credential namespace to use for this session" })),
  userAgent: t.Optional(t.String({ description: "Custom browser user agent" })),
  dimensions: t.Optional(t.Any({ description: "Viewport dimensions, e.g. { width: 1280, height: 768 }" })),
  stealthConfig: t.Optional(t.Any({ description: "Steel stealth configuration, e.g. { autoCaptchaSolving: false }" })),
  deviceConfig: t.Optional(t.Any({ description: "Device config, e.g. { device: 'mobile' }" })),
  profileId: t.Optional(t.String({ description: "Profile ID to load" })),
  persistProfile: t.Optional(t.Boolean({ description: "Persist profile changes on release" })),
  credentials: t.Optional(t.Any({ description: "Credentials injection options, or {} to enable defaults" })),
  extensionIds: t.Optional(t.Array(t.String(), { description: "Extension IDs to attach, or ['all_ext']" })),
  sessionContext: t.Optional(t.Any({ description: "Captured session context to restore" })),
  isSelenium: t.Optional(t.Boolean({ description: "Provision a Selenium-compatible session" })),
} as const;
