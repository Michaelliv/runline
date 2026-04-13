import type { RunlinePluginAPI } from "runline";

const BASE = "https://stackby.com/api/betav1";

async function apiRequest(
  apiKey: string, method: string, endpoint: string,
  body?: unknown, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { "api-key": apiKey, "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Stackby error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function stackby(rl: RunlinePluginAPI) {
  rl.setName("stackby");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Stackby API key", env: "STACKBY_API_KEY" },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiKey as string;

  rl.registerAction("row.read", {
    description: "Read a row by ID",
    inputSchema: {
      stackId: { type: "string", required: true },
      table: { type: "string", required: true },
      rowId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(key(ctx), "GET", `/rowlist/${p.stackId}/${encodeURIComponent(p.table as string)}`, undefined, { rowIds: p.rowId })) as Array<Record<string, unknown>>;
      return data.map(d => d.field);
    },
  });

  rl.registerAction("row.list", {
    description: "List rows from a table",
    inputSchema: {
      stackId: { type: "string", required: true },
      table: { type: "string", required: true },
      view: { type: "string", required: false },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.view) qs.view = p.view;
      if (p.limit) qs.maxrecord = p.limit;
      const data = (await apiRequest(key(ctx), "GET", `/rowlist/${p.stackId}/${encodeURIComponent(p.table as string)}`, undefined, qs)) as Array<Record<string, unknown>>;
      return data.map(d => d.field);
    },
  });

  rl.registerAction("row.append", {
    description: "Append rows to a table",
    inputSchema: {
      stackId: { type: "string", required: true },
      table: { type: "string", required: true },
      records: { type: "object", required: true, description: "Array of objects [{field: {col1: val1, col2: val2}}]" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(key(ctx), "POST", `/rowcreate/${p.stackId}/${encodeURIComponent(p.table as string)}`, { records: p.records })) as Array<Record<string, unknown>>;
      return data.map(d => d.field);
    },
  });

  rl.registerAction("row.delete", {
    description: "Delete a row by ID",
    inputSchema: {
      stackId: { type: "string", required: true },
      table: { type: "string", required: true },
      rowId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(key(ctx), "DELETE", `/rowdelete/${p.stackId}/${encodeURIComponent(p.table as string)}`, undefined, { rowIds: p.rowId });
    },
  });
}
