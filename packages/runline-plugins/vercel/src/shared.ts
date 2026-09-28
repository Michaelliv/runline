import { AuthError } from "runline";
import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { credentialOk } from "../../_shared/credentials.js";
import { vercelCredential } from "./credentials.js";

export type Ctx = ActionContext;

export type RequestOptions = {
  method?: HttpMethod;
  query?: Record<string, unknown>;
  body?: unknown;
};

export async function api(
  ctx: Ctx,
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  const query = Object.fromEntries(
    Object.entries({
      teamId: ctx.connection.config.teamId,
      slug: ctx.connection.config.slug,
      ...(options.query ?? {}),
    }).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );
  const res = await credentialOk(ctx, vercelCredential, "vercel", {
    target: "api",
    path: path.replace(/^\/+/, ""),
    method: options.method ?? "GET",
    query,
    ...(options.body !== undefined ? { json: options.body } : {}),
  });
  const text = await res.text();
  if (!text) return {};
  const contentType = res.headers.get("content-type") ?? "";
  if (
    contentType.includes("application/json") ||
    text.startsWith("{") ||
    text.startsWith("[")
  ) {
    try {
      return JSON.parse(text);
    } catch {
      throw new AuthError("invalid_response");
    }
  }
  return text;
}

export const TEAM_INPUT_SCHEMA = {
  teamId: t.Optional(
    t.String({
      description: "Override the configured Vercel Team ID for this call",
    }),
  ),
  slug: t.Optional(
    t.String({
      description: "Override the configured Vercel Team slug for this call",
    }),
  ),
} as const;

export const LIST_INPUT_SCHEMA = {
  ...TEAM_INPUT_SCHEMA,
  limit: t.Optional(t.Number({ description: "Maximum number of results" })),
  since: t.Optional(
    t.Number({ description: "Timestamp in milliseconds to start from" }),
  ),
  until: t.Optional(
    t.Number({ description: "Timestamp in milliseconds to end at" }),
  ),
  from: t.Optional(
    t.Number({
      description: "Pagination timestamp/cursor supported by Vercel",
    }),
  ),
  to: t.Optional(
    t.Number({
      description: "Pagination timestamp/cursor supported by Vercel",
    }),
  ),
} as const;

export function bindGetAction(rl: RunlinePluginAPI) {
  return (
    name: string,
    description: string,
    pathForId: (id: string) => string,
  ) => {
    rl.registerAction(name, {
      access: "read",
      description,
      inputSchema: t.Object({
        id: t.String({ description: "Resource ID, name, or URL" }),
        ...TEAM_INPUT_SCHEMA,
      }),
      async execute(input, ctx) {
        const { id, ...query } = input as { id: string } & Record<
          string,
          unknown
        >;
        return api(ctx, pathForId(id), { query });
      },
    });
  };
}
