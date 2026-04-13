import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  baseUrl: string,
  username: string,
  password: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${baseUrl}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${username}:${password}`)}`,
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Elasticsearch error ${res.status}: ${await res.text()}`);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return { success: true };
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const cfg = ctx.connection.config;
  return {
    baseUrl: (cfg.baseUrl as string).replace(/\/$/, ""),
    username: (cfg.username as string) ?? "",
    password: (cfg.password as string) ?? "",
  };
}

function req(ctx: { connection: { config: Record<string, unknown> } }, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>) {
  const { baseUrl, username, password } = getConn(ctx);
  return apiRequest(baseUrl, username, password, method, endpoint, body, qs);
}

export default function elasticsearch(rl: RunlinePluginAPI) {
  rl.setName("elasticsearch");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    baseUrl: { type: "string", required: true, description: "Elasticsearch base URL (e.g. https://localhost:9200)", env: "ELASTICSEARCH_URL" },
    username: { type: "string", required: false, description: "Username for basic auth", env: "ELASTICSEARCH_USERNAME" },
    password: { type: "string", required: false, description: "Password for basic auth", env: "ELASTICSEARCH_PASSWORD" },
  });

  // ── Document ────────────────────────────────────────

  rl.registerAction("document.create", {
    description: "Index (create) a document",
    inputSchema: {
      index: { type: "string", required: true, description: "Index name" },
      id: { type: "string", required: false, description: "Document ID (auto-generated if omitted)" },
      body: { type: "object", required: true, description: "Document body" },
    },
    async execute(input, ctx) {
      const { index, id, body } = input as Record<string, unknown>;
      const endpoint = id ? `/${index}/_doc/${id}` : `/${index}/_doc`;
      return req(ctx, id ? "PUT" : "POST", endpoint, body as Record<string, unknown>);
    },
  });

  rl.registerAction("document.get", {
    description: "Get a document by ID",
    inputSchema: {
      index: { type: "string", required: true, description: "Index name" },
      id: { type: "string", required: true, description: "Document ID" },
    },
    async execute(input, ctx) {
      const { index, id } = input as { index: string; id: string };
      return req(ctx, "GET", `/${index}/_doc/${id}`);
    },
  });

  rl.registerAction("document.update", {
    description: "Update a document",
    inputSchema: {
      index: { type: "string", required: true, description: "Index name" },
      id: { type: "string", required: true, description: "Document ID" },
      body: { type: "object", required: true, description: "Partial document to merge" },
    },
    async execute(input, ctx) {
      const { index, id, body } = input as Record<string, unknown>;
      return req(ctx, "POST", `/${index}/_update/${id}`, { doc: body });
    },
  });

  rl.registerAction("document.delete", {
    description: "Delete a document",
    inputSchema: {
      index: { type: "string", required: true, description: "Index name" },
      id: { type: "string", required: true, description: "Document ID" },
    },
    async execute(input, ctx) {
      const { index, id } = input as { index: string; id: string };
      return req(ctx, "DELETE", `/${index}/_doc/${id}`);
    },
  });

  rl.registerAction("document.search", {
    description: "Search documents in an index",
    inputSchema: {
      index: { type: "string", required: true, description: "Index name" },
      query: { type: "object", required: false, description: "Elasticsearch query DSL" },
      size: { type: "number", required: false, description: "Max results (default: 10)" },
      from: { type: "number", required: false, description: "Offset" },
      sort: { type: "array", required: false, description: "Sort criteria" },
    },
    async execute(input, ctx) {
      const { index, query, size, from: offset, sort } = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (query) body.query = query;
      if (size !== undefined) body.size = size;
      if (offset !== undefined) body.from = offset;
      if (sort) body.sort = sort;
      const data = (await req(ctx, "POST", `/${index}/_search`, body)) as Record<string, unknown>;
      return (data.hits as Record<string, unknown>)?.hits;
    },
  });

  // ── Index ───────────────────────────────────────────

  rl.registerAction("index.create", {
    description: "Create an index",
    inputSchema: {
      index: { type: "string", required: true, description: "Index name" },
      settings: { type: "object", required: false, description: "Index settings" },
      mappings: { type: "object", required: false, description: "Index mappings" },
    },
    async execute(input, ctx) {
      const { index, settings, mappings } = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (settings) body.settings = settings;
      if (mappings) body.mappings = mappings;
      return req(ctx, "PUT", `/${index}`, Object.keys(body).length > 0 ? body : undefined);
    },
  });

  rl.registerAction("index.get", {
    description: "Get index details",
    inputSchema: { index: { type: "string", required: true, description: "Index name" } },
    async execute(input, ctx) {
      return req(ctx, "GET", `/${(input as { index: string }).index}`);
    },
  });

  rl.registerAction("index.list", {
    description: "List all indices",
    async execute(_input, ctx) {
      return req(ctx, "GET", "/_cat/indices", undefined, { format: "json" });
    },
  });

  rl.registerAction("index.delete", {
    description: "Delete an index",
    inputSchema: { index: { type: "string", required: true, description: "Index name" } },
    async execute(input, ctx) {
      return req(ctx, "DELETE", `/${(input as { index: string }).index}`);
    },
  });
}
