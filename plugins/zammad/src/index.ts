import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return { url: (c.url as string).replace(/\/$/, ""), token: c.token as string };
}

async function api(conn: ReturnType<typeof getConn>, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${conn.url}/api/v1${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Token token=${conn.token}`, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Zammad error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

function registerCrud(
  rl: RunlinePluginAPI, resource: string, plural: string,
  conn: (ctx: { connection: { config: Record<string, unknown> } }) => ReturnType<typeof getConn>,
  createSchema: Record<string, { type: string; required: boolean; description?: string }>,
) {
  rl.registerAction(`${resource}.create`, { description: `Create a ${resource}`, inputSchema: createSchema,
    async execute(input, ctx) { return api(conn(ctx), "POST", `/${plural}`, input as Record<string, unknown>); } });

  rl.registerAction(`${resource}.get`, { description: `Get a ${resource} by ID`, inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return api(conn(ctx), "GET", `/${plural}/${(input as Record<string, unknown>).id}`); } });

  rl.registerAction(`${resource}.list`, { description: `List ${plural}`, inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { per_page: p.limit ?? 100 };
      return api(conn(ctx), "GET", `/${plural}`, undefined, qs);
    } });

  rl.registerAction(`${resource}.update`, { description: `Update a ${resource}`, inputSchema: { id: { type: "string", required: true }, data: { type: "object", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(conn(ctx), "PUT", `/${plural}/${p.id}`, p.data as Record<string, unknown>); } });

  rl.registerAction(`${resource}.delete`, { description: `Delete a ${resource}`, inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { await api(conn(ctx), "DELETE", `/${plural}/${(input as Record<string, unknown>).id}`); return { success: true }; } });
}

export default function zammad(rl: RunlinePluginAPI) {
  rl.setName("zammad");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    url: { type: "string", required: true, description: "Zammad instance URL", env: "ZAMMAD_URL" },
    token: { type: "string", required: true, description: "Zammad access token", env: "ZAMMAD_TOKEN" },
  });

  registerCrud(rl, "user", "users", getConn, { firstname: { type: "string", required: true }, lastname: { type: "string", required: true }, email: { type: "string", required: false } });
  registerCrud(rl, "organization", "organizations", getConn, { name: { type: "string", required: true } });
  registerCrud(rl, "group", "groups", getConn, { name: { type: "string", required: true } });

  // ── Ticket (special: includes article) ──────────────

  rl.registerAction("ticket.create", { description: "Create a ticket", inputSchema: {
    title: { type: "string", required: true }, group: { type: "string", required: true },
    customer: { type: "string", required: true, description: "Customer email" },
    articleBody: { type: "string", required: true }, articleSubject: { type: "string", required: false },
    articleInternal: { type: "boolean", required: false },
  },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { title: p.title, group: p.group, customer: p.customer, article: { body: p.articleBody, internal: p.articleInternal ?? false } };
      if (p.articleSubject) (body.article as Record<string, unknown>).subject = p.articleSubject;
      return api(getConn(ctx), "POST", "/tickets", body);
    } });

  rl.registerAction("ticket.get", { description: "Get a ticket with articles", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const c = getConn(ctx);
      const id = (input as Record<string, unknown>).id;
      const ticket = (await api(c, "GET", `/tickets/${id}`)) as Record<string, unknown>;
      ticket.articles = await api(c, "GET", `/ticket_articles/by_ticket/${id}`);
      return ticket;
    } });

  rl.registerAction("ticket.list", { description: "List tickets", inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = { per_page: ((input ?? {}) as Record<string, unknown>).limit ?? 100 };
      return api(getConn(ctx), "GET", "/tickets", undefined, qs);
    } });

  rl.registerAction("ticket.update", { description: "Update a ticket", inputSchema: { id: { type: "string", required: true }, data: { type: "object", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(getConn(ctx), "PUT", `/tickets/${p.id}`, p.data as Record<string, unknown>); } });

  rl.registerAction("ticket.delete", { description: "Delete a ticket", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { await api(getConn(ctx), "DELETE", `/tickets/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  // ── User extras ─────────────────────────────────────

  rl.registerAction("user.getSelf", { description: "Get the current user", inputSchema: {},
    async execute(_input, ctx) { return api(getConn(ctx), "GET", "/users/me"); } });

  rl.registerAction("user.search", { description: "Search users", inputSchema: { query: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { query: p.query };
      if (p.limit) qs.per_page = p.limit;
      return api(getConn(ctx), "GET", "/users/search", undefined, qs);
    } });
}
