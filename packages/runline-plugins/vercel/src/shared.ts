import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";

const BASE_URL = "https://api.vercel.com";

export type Ctx = { connection: { config: Record<string, unknown> } };

export function token(ctx: Ctx): string {
  return ctx.connection.config.token as string;
}

export type RequestOptions = {
  method?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
};

export async function api(
  ctx: Ctx,
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  const url = new URL(path, BASE_URL);
  const query = {
    teamId: ctx.connection.config.teamId,
    slug: ctx.connection.config.slug,
    ...(options.query ?? {}),
  };
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  const init: RequestInit = {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token(ctx)}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const res = await fetch(url.toString(), init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Vercel API error ${res.status}: ${text || res.statusText}`);
  }
  if (!text) return {};
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || text.startsWith("{") || text.startsWith("[")) {
    return JSON.parse(text);
  }
  return text;
}

export const TEAM_INPUT_SCHEMA = {
  teamId: t.Optional(t.String({ description: "Override the configured Vercel Team ID for this call" })),
  slug: t.Optional(t.String({ description: "Override the configured Vercel Team slug for this call" })),
} as const;

export const LIST_INPUT_SCHEMA = {
  ...TEAM_INPUT_SCHEMA,
  limit: t.Optional(t.Number({ description: "Maximum number of results" })),
  since: t.Optional(t.Number({ description: "Timestamp in milliseconds to start from" })),
  until: t.Optional(t.Number({ description: "Timestamp in milliseconds to end at" })),
  from: t.Optional(t.Number({ description: "Pagination timestamp/cursor supported by Vercel" })),
  to: t.Optional(t.Number({ description: "Pagination timestamp/cursor supported by Vercel" })),
} as const;

export function bindGetAction(rl: RunlinePluginAPI) {
  return (
    name: string,
    description: string,
    pathForId: (id: string) => string,
  ) => {
    rl.registerAction(name, {
      description,
      inputSchema: t.Object({
        id: t.String({ description: "Resource ID, name, or URL" }),
        ...TEAM_INPUT_SCHEMA,
      }),
      async execute(input, ctx) {
        const { id, ...query } = input as { id: string } & Record<string, unknown>;
        return api(ctx, pathForId(id), { query });
      },
    });
  };
}
