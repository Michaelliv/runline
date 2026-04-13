import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  baseUrl: string,
  apiKey: string,
  method: string,
  endpoint: string,
  body?: unknown,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${baseUrl}/api${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  };
  if (body !== undefined && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Grist API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const cfg = ctx.connection.config;
  const planType = cfg.planType as string ?? "free";
  let baseUrl: string;
  if (planType === "selfHosted") baseUrl = (cfg.selfHostedUrl as string).replace(/\/$/, "");
  else if (planType === "paid") baseUrl = `https://${cfg.subdomain}.getgrist.com`;
  else baseUrl = "https://docs.getgrist.com";
  return { baseUrl, apiKey: cfg.apiKey as string };
}

export default function grist(rl: RunlinePluginAPI) {
  rl.setName("grist");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Grist API key", env: "GRIST_API_KEY" },
    planType: { type: "string", required: false, description: "free (default), paid, or selfHosted", default: "free" },
    subdomain: { type: "string", required: false, description: "Subdomain for paid plan" },
    selfHostedUrl: { type: "string", required: false, description: "Full URL for self-hosted", env: "GRIST_URL" },
  });

  rl.registerAction("record.create", {
    description: "Create records in a table",
    inputSchema: {
      docId: { type: "string", required: true, description: "Document ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      records: { type: "array", required: true, description: "Array of {fields: {col: value}} objects" },
    },
    async execute(input, ctx) {
      const { docId, tableId, records } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "POST", `/docs/${docId}/tables/${tableId}/records`, { records });
    },
  });

  rl.registerAction("record.list", {
    description: "List records from a table",
    inputSchema: {
      docId: { type: "string", required: true, description: "Document ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      limit: { type: "number", required: false, description: "Max results" },
      sort: { type: "string", required: false, description: "Sort columns (e.g. 'Name,-Age')" },
      filter: { type: "object", required: false, description: "Filter as {column: [values]}" },
    },
    async execute(input, ctx) {
      const { docId, tableId, limit, sort, filter } = (input ?? {}) as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      const qs: Record<string, unknown> = {};
      if (limit) qs.limit = limit;
      if (sort) qs.sort = sort;
      if (filter) qs.filter = JSON.stringify(filter);
      const data = (await apiRequest(baseUrl, apiKey, "GET", `/docs/${docId}/tables/${tableId}/records`, undefined, qs)) as Record<string, unknown>;
      return data.records;
    },
  });

  rl.registerAction("record.update", {
    description: "Update records in a table",
    inputSchema: {
      docId: { type: "string", required: true, description: "Document ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      records: { type: "array", required: true, description: "Array of {id, fields: {col: value}} objects" },
    },
    async execute(input, ctx) {
      const { docId, tableId, records } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "PATCH", `/docs/${docId}/tables/${tableId}/records`, { records });
    },
  });

  rl.registerAction("record.delete", {
    description: "Delete records from a table",
    inputSchema: {
      docId: { type: "string", required: true, description: "Document ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      rowIds: { type: "array", required: true, description: "Array of row IDs to delete" },
    },
    async execute(input, ctx) {
      const { docId, tableId, rowIds } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = getConn(ctx);
      return apiRequest(baseUrl, apiKey, "POST", `/docs/${docId}/tables/${tableId}/data/delete`, rowIds);
    },
  });
}
