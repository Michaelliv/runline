import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://connect.mailerlite.com/api";

async function apiRequest(
  token: string, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const opts: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`MailerLite API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function paginateAll(
  token: string, method: string, endpoint: string, qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  qs.limit = 1000;
  let cursor: string | null = null;
  do {
    if (cursor) qs.cursor = cursor;
    const resp = (await apiRequest(token, method, endpoint, undefined, qs)) as Record<string, unknown>;
    const data = resp.data as unknown[];
    if (data) all.push(...data);
    const meta = resp.meta as Record<string, unknown> | undefined;
    const links = resp.links as Record<string, unknown> | undefined;
    cursor = (meta?.next_cursor as string) ?? null;
    if (!links?.next) cursor = null;
  } while (cursor);
  return all;
}

export default function mailerlite(rl: RunlinePluginAPI) {
  rl.setName("mailerlite");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "MailerLite API token", env: "MAILERLITE_API_KEY" },
  });

  const tok = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiKey as string;

  rl.registerAction("subscriber.create", {
    description: "Create a subscriber",
    inputSchema: {
      email: { type: "string", required: true },
      fields: { type: "object", required: false, description: "Custom fields as {field_key: value}" },
      groups: { type: "array", required: false, description: "Array of group IDs" },
      status: { type: "string", required: false, description: "active, unsubscribed, unconfirmed, bounced, junk" },
      subscribed_at: { type: "string", required: false, description: "ISO datetime" },
      ip_address: { type: "string", required: false },
      opted_in_at: { type: "string", required: false },
      optin_ip: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { email, fields, ...rest } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { email };
      if (fields) body.fields = fields;
      for (const [k, v] of Object.entries(rest)) { if (v !== undefined && v !== null) body[k] = v; }
      const resp = (await apiRequest(tok(ctx), "POST", "/subscribers", body)) as Record<string, unknown>;
      return resp.data;
    },
  });

  rl.registerAction("subscriber.get", {
    description: "Get a subscriber by ID or email",
    inputSchema: { subscriberId: { type: "string", required: true, description: "Subscriber ID or email" } },
    async execute(input, ctx) {
      const resp = (await apiRequest(tok(ctx), "GET", `/subscribers/${encodeURIComponent((input as { subscriberId: string }).subscriberId)}`)) as Record<string, unknown>;
      return resp.data;
    },
  });

  rl.registerAction("subscriber.list", {
    description: "List subscribers",
    inputSchema: {
      limit: { type: "number", required: false },
      status: { type: "string", required: false, description: "Filter by status: active, unsubscribed, unconfirmed, bounced, junk" },
    },
    async execute(input, ctx) {
      const { limit, status } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (status) qs["filter[status]"] = status;
      if (limit) {
        qs.limit = limit;
        const resp = (await apiRequest(tok(ctx), "GET", "/subscribers", undefined, qs)) as Record<string, unknown>;
        return resp.data;
      }
      return paginateAll(tok(ctx), "GET", "/subscribers", qs);
    },
  });

  rl.registerAction("subscriber.update", {
    description: "Update a subscriber",
    inputSchema: {
      subscriberId: { type: "string", required: true, description: "Subscriber ID or email" },
      fields: { type: "object", required: false, description: "Custom fields as {field_key: value}" },
      groups: { type: "array", required: false, description: "Array of group IDs" },
      status: { type: "string", required: false },
      subscribed_at: { type: "string", required: false },
      ip_address: { type: "string", required: false },
      opted_in_at: { type: "string", required: false },
      optin_ip: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { subscriberId, fields, ...rest } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields) body.fields = fields;
      for (const [k, v] of Object.entries(rest)) { if (v !== undefined && v !== null && k !== "subscriberId") body[k] = v; }
      return apiRequest(tok(ctx), "PUT", `/subscribers/${encodeURIComponent(subscriberId as string)}`, body);
    },
  });
}
