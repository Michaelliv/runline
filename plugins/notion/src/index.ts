import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2021-08-16";

async function api(token: string, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Notion error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function notion(rl: RunlinePluginAPI) {
  rl.setName("notion");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({ apiKey: { type: "string", required: true, description: "Notion integration token (secret_...)", env: "NOTION_API_KEY" } });
  const t = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiKey as string;

  // ── Block ───────────────────────────────────────────

  rl.registerAction("block.append", { description: "Append children blocks to a block/page",
    inputSchema: { blockId: { type: "string", required: true }, children: { type: "object", required: true, description: "Array of block objects" } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(t(ctx), "PATCH", `/blocks/${p.blockId}/children`, { children: p.children }); } });

  rl.registerAction("block.getChildren", { description: "Get child blocks of a block/page",
    inputSchema: { blockId: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.page_size = p.limit;
      const data = (await api(t(ctx), "GET", `/blocks/${p.blockId}/children`, undefined, qs)) as Record<string, unknown>;
      return data.results;
    } });

  rl.registerAction("block.delete", { description: "Delete (archive) a block",
    inputSchema: { blockId: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "DELETE", `/blocks/${(input as Record<string, unknown>).blockId}`); } });

  // ── Database ────────────────────────────────────────

  rl.registerAction("database.get", { description: "Get a database",
    inputSchema: { databaseId: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", `/databases/${(input as Record<string, unknown>).databaseId}`); } });

  rl.registerAction("database.list", { description: "List all databases (via search)",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const body: Record<string, unknown> = { filter: { property: "object", value: "database" } };
      if ((input as Record<string, unknown>)?.limit) body.page_size = (input as Record<string, unknown>).limit;
      const data = (await api(t(ctx), "POST", "/search", body)) as Record<string, unknown>;
      return data.results;
    } });

  rl.registerAction("database.query", { description: "Query a database (list pages with filters)",
    inputSchema: { databaseId: { type: "string", required: true }, filter: { type: "object", required: false, description: "Notion filter object" }, sorts: { type: "object", required: false, description: "Array of sort objects" }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.filter) body.filter = p.filter;
      if (p.sorts) body.sorts = p.sorts;
      if (p.limit) body.page_size = p.limit;
      const data = (await api(t(ctx), "POST", `/databases/${p.databaseId}/query`, body)) as Record<string, unknown>;
      return data.results;
    } });

  // ── Page ────────────────────────────────────────────

  rl.registerAction("page.create", { description: "Create a page (in a database or under a page)",
    inputSchema: { parent: { type: "object", required: true, description: "{ database_id: '...' } or { page_id: '...' }" }, properties: { type: "object", required: true, description: "Page properties" }, children: { type: "object", required: false, description: "Array of block children" }, icon: { type: "object", required: false } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/pages", input as Record<string, unknown>); } });

  rl.registerAction("page.get", { description: "Get a page",
    inputSchema: { pageId: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", `/pages/${(input as Record<string, unknown>).pageId}`); } });

  rl.registerAction("page.update", { description: "Update page properties",
    inputSchema: { pageId: { type: "string", required: true }, properties: { type: "object", required: false }, archived: { type: "boolean", required: false }, icon: { type: "object", required: false } },
    async execute(input, ctx) {
      const { pageId, ...body } = input as Record<string, unknown>;
      return api(t(ctx), "PATCH", `/pages/${pageId}`, body);
    } });

  rl.registerAction("page.archive", { description: "Archive a page",
    inputSchema: { pageId: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "PATCH", `/pages/${(input as Record<string, unknown>).pageId}`, { archived: true }); } });

  rl.registerAction("page.search", { description: "Search pages",
    inputSchema: { query: { type: "string", required: false }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.query) body.query = p.query;
      if (p.limit) body.page_size = p.limit;
      const data = (await api(t(ctx), "POST", "/search", body)) as Record<string, unknown>;
      return data.results;
    } });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.get", { description: "Get a user",
    inputSchema: { userId: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", `/users/${(input as Record<string, unknown>).userId}`); } });

  rl.registerAction("user.list", { description: "List all users",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit) qs.page_size = (input as Record<string, unknown>).limit;
      const data = (await api(t(ctx), "GET", "/users", undefined, qs)) as Record<string, unknown>;
      return data.results;
    } });

  rl.registerAction("user.me", { description: "Get the bot user",
    inputSchema: {},
    async execute(_input, ctx) { return api(t(ctx), "GET", "/users/me"); } });
}
