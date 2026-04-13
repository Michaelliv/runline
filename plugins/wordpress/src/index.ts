import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return { url: (c.url as string).replace(/\/$/, ""), username: c.username as string, password: c.password as string };
}

async function apiRequest(
  conn: ReturnType<typeof getConn>, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${conn.url}/wp-json/wp/v2${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = {
    method,
    headers: { Authorization: `Basic ${btoa(`${conn.username}:${conn.password}`)}`, "Content-Type": "application/json", Accept: "application/json" },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`WordPress error ${res.status}: ${await res.text()}`);
  return res.json();
}

function registerContentCrud(
  rl: RunlinePluginAPI, resource: string, plural: string,
  conn: (ctx: { connection: { config: Record<string, unknown> } }) => ReturnType<typeof getConn>,
) {
  rl.registerAction(`${resource}.create`, {
    description: `Create a ${resource}`,
    inputSchema: { title: { type: "string", required: true }, content: { type: "string", required: false }, status: { type: "string", required: false, description: "publish, draft, pending, private" }, slug: { type: "string", required: false } },
    async execute(input, ctx) { return apiRequest(conn(ctx), "POST", `/${plural}`, input as Record<string, unknown>); },
  });

  rl.registerAction(`${resource}.get`, {
    description: `Get a ${resource} by ID`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(conn(ctx), "GET", `/${plural}/${(input as Record<string, unknown>).id}`); },
  });

  rl.registerAction(`${resource}.list`, {
    description: `List ${plural}`,
    inputSchema: { limit: { type: "number", required: false }, search: { type: "string", required: false }, status: { type: "string", required: false }, orderby: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.per_page = p.limit;
      if (p.search) qs.search = p.search;
      if (p.status) qs.status = p.status;
      if (p.orderby) qs.orderby = p.orderby;
      return apiRequest(conn(ctx), "GET", `/${plural}`, undefined, qs);
    },
  });

  rl.registerAction(`${resource}.update`, {
    description: `Update a ${resource}`,
    inputSchema: { id: { type: "string", required: true }, title: { type: "string", required: false }, content: { type: "string", required: false }, status: { type: "string", required: false }, slug: { type: "string", required: false } },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      return apiRequest(conn(ctx), "POST", `/${plural}/${id}`, fields);
    },
  });

  rl.registerAction(`${resource}.delete`, {
    description: `Delete a ${resource}`,
    inputSchema: { id: { type: "string", required: true }, force: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.force) qs.force = "true";
      return apiRequest(conn(ctx), "DELETE", `/${plural}/${p.id}`, undefined, qs);
    },
  });
}

export default function wordpress(rl: RunlinePluginAPI) {
  rl.setName("wordpress");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    url: { type: "string", required: true, description: "WordPress site URL", env: "WORDPRESS_URL" },
    username: { type: "string", required: true, description: "WordPress username", env: "WORDPRESS_USERNAME" },
    password: { type: "string", required: true, description: "WordPress application password", env: "WORDPRESS_PASSWORD" },
  });

  registerContentCrud(rl, "post", "posts", getConn);
  registerContentCrud(rl, "page", "pages", getConn);

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.create", {
    description: "Create a user",
    inputSchema: { username: { type: "string", required: true }, email: { type: "string", required: true }, password: { type: "string", required: true }, name: { type: "string", required: false } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "POST", "/users", input as Record<string, unknown>); },
  });

  rl.registerAction("user.get", {
    description: "Get a user by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "GET", `/users/${(input as Record<string, unknown>).id}`); },
  });

  rl.registerAction("user.list", {
    description: "List users",
    inputSchema: { limit: { type: "number", required: false }, search: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.per_page = p.limit;
      if (p.search) qs.search = p.search;
      return apiRequest(getConn(ctx), "GET", "/users", undefined, qs);
    },
  });

  rl.registerAction("user.update", {
    description: "Update a user",
    inputSchema: { id: { type: "string", required: true }, name: { type: "string", required: false }, email: { type: "string", required: false }, description: { type: "string", required: false } },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", `/users/${id}`, fields);
    },
  });

  rl.registerAction("user.delete", {
    description: "Delete the current user",
    inputSchema: { reassign: { type: "string", required: true, description: "User ID to reassign content to" } },
    async execute(input, ctx) {
      return apiRequest(getConn(ctx), "DELETE", "/users/me", undefined, { reassign: (input as Record<string, unknown>).reassign, force: "true" });
    },
  });
}
