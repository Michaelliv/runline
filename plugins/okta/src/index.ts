import type { RunlinePluginAPI } from "runline";

interface Conn { config: Record<string, unknown> }

function getConn(ctx: { connection: Conn }) {
  const c = ctx.connection.config;
  const url = (c.url as string).replace(/\/$/, "");
  return { url, apiToken: c.apiToken as string };
}

async function apiRequest(
  conn: { url: string; apiToken: string },
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<{ data: unknown; linkHeader?: string }> {
  const u = new URL(`${conn.url}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `SSWS ${conn.apiToken}`,
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(u.toString(), init);
  if (!res.ok) throw new Error(`Okta API error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { data, linkHeader: res.headers.get("link") ?? undefined };
}

async function paginate(
  conn: { url: string; apiToken: string },
  endpoint: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  let after: string | undefined;
  do {
    if (after) qs.after = after;
    qs.limit = 200;
    const { data, linkHeader } = await apiRequest(conn, "GET", endpoint, undefined, qs);
    const items = Array.isArray(data) ? data : [];
    all.push(...items);
    after = undefined;
    if (linkHeader) {
      const match = linkHeader.match(/after=([^&>]+)/);
      if (match) after = match[1];
    }
  } while (after);
  return all;
}

export default function okta(rl: RunlinePluginAPI) {
  rl.setName("okta");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    url: { type: "string", required: true, description: "Okta org URL (e.g. https://yourorg.okta.com)", env: "OKTA_URL" },
    apiToken: { type: "string", required: true, description: "Okta API token (SSWS)", env: "OKTA_API_TOKEN" },
  });

  rl.registerAction("user.create", {
    description: "Create a new user in Okta",
    inputSchema: {
      firstName: { type: "string", required: true },
      lastName: { type: "string", required: true },
      login: { type: "string", required: true, description: "Username (must be email)" },
      email: { type: "string", required: true },
      activate: { type: "boolean", required: false, description: "Activate user immediately (default true)" },
      password: { type: "string", required: false },
      profile: { type: "object", required: false, description: "Additional profile fields (city, department, displayName, etc.)" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const conn = getConn(ctx);
      const body: Record<string, unknown> = {
        profile: {
          firstName: p.firstName,
          lastName: p.lastName,
          login: p.login,
          email: p.email,
          ...(p.profile as Record<string, unknown> ?? {}),
        },
      };
      if (p.password) {
        body.credentials = { password: { value: p.password } };
      }
      const qs: Record<string, unknown> = { activate: p.activate !== false ? "true" : "false" };
      const { data } = await apiRequest(conn, "POST", "/api/v1/users/", body, qs);
      return data;
    },
  });

  rl.registerAction("user.get", {
    description: "Get user details by ID or login",
    inputSchema: {
      userId: { type: "string", required: true, description: "User ID or login (email)" },
    },
    async execute(input, ctx) {
      const { userId } = input as Record<string, unknown>;
      const { data } = await apiRequest(getConn(ctx), "GET", `/api/v1/users/${userId}`);
      return data;
    },
  });

  rl.registerAction("user.list", {
    description: "List users (with optional search query)",
    inputSchema: {
      search: { type: "string", required: false, description: "Search/filter query, e.g. profile.lastName sw \"Smi\"" },
      limit: { type: "number", required: false, description: "Max results (default all)" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const conn = getConn(ctx);
      const qs: Record<string, unknown> = {};
      if (p.search) qs.search = p.search;
      if (p.limit) {
        qs.limit = p.limit;
        const { data } = await apiRequest(conn, "GET", "/api/v1/users/", undefined, qs);
        return data;
      }
      return paginate(conn, "/api/v1/users/", qs);
    },
  });

  rl.registerAction("user.update", {
    description: "Update a user's profile",
    inputSchema: {
      userId: { type: "string", required: true, description: "User ID" },
      profile: { type: "object", required: true, description: "Profile fields to update (firstName, lastName, email, login, city, department, etc.)" },
    },
    async execute(input, ctx) {
      const { userId, profile } = input as Record<string, unknown>;
      const { data } = await apiRequest(getConn(ctx), "POST", `/api/v1/users/${userId}`, { profile });
      return data;
    },
  });

  rl.registerAction("user.delete", {
    description: "Delete (deactivate and then delete) a user",
    inputSchema: {
      userId: { type: "string", required: true, description: "User ID" },
    },
    async execute(input, ctx) {
      const { userId } = input as Record<string, unknown>;
      await apiRequest(getConn(ctx), "DELETE", `/api/v1/users/${userId}`);
      return { success: true };
    },
  });
}
