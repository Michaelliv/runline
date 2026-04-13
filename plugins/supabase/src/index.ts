import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return { host: (c.host as string).replace(/\/$/, ""), serviceRole: c.serviceRole as string };
}

async function apiRequest(
  conn: ReturnType<typeof getConn>, method: string, endpoint: string,
  body?: unknown, qs?: Record<string, unknown>, extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${conn.host}/rest/v1${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const headers: Record<string, string> = {
    apikey: conn.serviceRole,
    Authorization: `Bearer ${conn.serviceRole}`,
    Prefer: "return=representation",
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export default function supabase(rl: RunlinePluginAPI) {
  rl.setName("supabase");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    host: { type: "string", required: true, description: "Supabase project URL (e.g. https://xxx.supabase.co)", env: "SUPABASE_URL" },
    serviceRole: { type: "string", required: true, description: "Supabase service_role key", env: "SUPABASE_SERVICE_ROLE_KEY" },
  });

  rl.registerAction("row.create", {
    description: "Insert rows into a table",
    inputSchema: {
      table: { type: "string", required: true },
      data: { type: "object", required: true, description: "Row data (or array of rows)" },
      schema: { type: "string", required: false, description: "Database schema (default: public)" },
    },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      const p = input as Record<string, unknown>;
      const headers: Record<string, string> = {};
      if (p.schema && p.schema !== "public") headers["Content-Profile"] = p.schema as string;
      return apiRequest(conn, "POST", `/${p.table}`, p.data, undefined, headers);
    },
  });

  rl.registerAction("row.get", {
    description: "Get rows by filter (PostgREST query params)",
    inputSchema: {
      table: { type: "string", required: true },
      filters: { type: "object", required: true, description: "PostgREST filters, e.g. { id: 'eq.5' }" },
      schema: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      const p = input as Record<string, unknown>;
      const headers: Record<string, string> = {};
      if (p.schema && p.schema !== "public") headers["Accept-Profile"] = p.schema as string;
      return apiRequest(conn, "GET", `/${p.table}`, undefined, p.filters as Record<string, unknown>, headers);
    },
  });

  rl.registerAction("row.list", {
    description: "List rows from a table",
    inputSchema: {
      table: { type: "string", required: true },
      limit: { type: "number", required: false },
      filters: { type: "object", required: false, description: "PostgREST filters" },
      schema: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { ...(p.filters as Record<string, unknown> ?? {}) };
      if (p.limit) qs.limit = p.limit;
      const headers: Record<string, string> = {};
      if (p.schema && p.schema !== "public") headers["Accept-Profile"] = p.schema as string;
      return apiRequest(conn, "GET", `/${p.table}`, undefined, qs, headers);
    },
  });

  rl.registerAction("row.update", {
    description: "Update rows matching a filter",
    inputSchema: {
      table: { type: "string", required: true },
      data: { type: "object", required: true, description: "Fields to update" },
      filters: { type: "object", required: true, description: "PostgREST filters to match rows" },
      schema: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      const p = input as Record<string, unknown>;
      const headers: Record<string, string> = {};
      if (p.schema && p.schema !== "public") headers["Content-Profile"] = p.schema as string;
      return apiRequest(conn, "PATCH", `/${p.table}`, p.data, p.filters as Record<string, unknown>, headers);
    },
  });

  rl.registerAction("row.delete", {
    description: "Delete rows matching a filter",
    inputSchema: {
      table: { type: "string", required: true },
      filters: { type: "object", required: true, description: "PostgREST filters to match rows" },
      schema: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      const p = input as Record<string, unknown>;
      const headers: Record<string, string> = {};
      if (p.schema && p.schema !== "public") headers["Content-Profile"] = p.schema as string;
      return apiRequest(conn, "DELETE", `/${p.table}`, undefined, p.filters as Record<string, unknown>, headers);
    },
  });
}
