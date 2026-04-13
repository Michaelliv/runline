import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  host: string,
  apiKey: string,
  apiSecret: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${host}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `token ${apiKey}:${apiSecret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`ERPNext API error ${res.status}: ${await res.text()}`);
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const cfg = ctx.connection.config;
  return {
    host: (cfg.host as string).replace(/\/$/, ""),
    apiKey: cfg.apiKey as string,
    apiSecret: cfg.apiSecret as string,
  };
}

function req(ctx: { connection: { config: Record<string, unknown> } }, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>) {
  const { host, apiKey, apiSecret } = getConn(ctx);
  return apiRequest(host, apiKey, apiSecret, method, endpoint, body, qs);
}

export default function erpnext(rl: RunlinePluginAPI) {
  rl.setName("erpnext");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    host: { type: "string", required: true, description: "ERPNext instance URL (e.g. https://mysite.erpnext.com)", env: "ERPNEXT_HOST" },
    apiKey: { type: "string", required: true, description: "API key", env: "ERPNEXT_API_KEY" },
    apiSecret: { type: "string", required: true, description: "API secret", env: "ERPNEXT_API_SECRET" },
  });

  rl.registerAction("document.get", {
    description: "Get a document by DocType and name",
    inputSchema: {
      docType: { type: "string", required: true, description: "Document type (e.g. Customer, Sales Order)" },
      documentName: { type: "string", required: true, description: "Document name/ID" },
    },
    async execute(input, ctx) {
      const { docType, documentName } = input as { docType: string; documentName: string };
      const data = (await req(ctx, "GET", `/api/resource/${encodeURIComponent(docType)}/${encodeURIComponent(documentName)}`)) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("document.list", {
    description: "List documents of a DocType",
    inputSchema: {
      docType: { type: "string", required: true, description: "Document type" },
      fields: { type: "array", required: false, description: "Fields to return (default: ['name']). Use ['*'] for all." },
      filters: { type: "array", required: false, description: 'Filters as [[doctype, field, operator, value], ...]' },
      limit: { type: "number", required: false, description: "Max results (default: 20)" },
      offset: { type: "number", required: false, description: "Start offset" },
      orderBy: { type: "string", required: false, description: "Order by (e.g. 'creation desc')" },
    },
    async execute(input, ctx) {
      const { docType, fields, filters, limit, offset, orderBy } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (fields) qs.fields = JSON.stringify(fields);
      if (filters) qs.filters = JSON.stringify(filters);
      if (limit) qs.limit_page_length = limit;
      if (offset) qs.limit_start = offset;
      if (orderBy) qs.order_by = orderBy;
      const data = (await req(ctx, "GET", `/api/resource/${encodeURIComponent(docType as string)}`, undefined, qs)) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("document.create", {
    description: "Create a document",
    inputSchema: {
      docType: { type: "string", required: true, description: "Document type" },
      properties: { type: "object", required: true, description: "Document field values as key-value pairs" },
    },
    async execute(input, ctx) {
      const { docType, properties } = input as { docType: string; properties: Record<string, unknown> };
      const data = (await req(ctx, "POST", `/api/resource/${encodeURIComponent(docType)}`, properties)) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("document.update", {
    description: "Update a document",
    inputSchema: {
      docType: { type: "string", required: true, description: "Document type" },
      documentName: { type: "string", required: true, description: "Document name/ID" },
      properties: { type: "object", required: true, description: "Fields to update as key-value pairs" },
    },
    async execute(input, ctx) {
      const { docType, documentName, properties } = input as { docType: string; documentName: string; properties: Record<string, unknown> };
      const data = (await req(ctx, "PUT", `/api/resource/${encodeURIComponent(docType)}/${encodeURIComponent(documentName)}`, properties)) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("document.delete", {
    description: "Delete a document",
    inputSchema: {
      docType: { type: "string", required: true, description: "Document type" },
      documentName: { type: "string", required: true, description: "Document name/ID" },
    },
    async execute(input, ctx) {
      const { docType, documentName } = input as { docType: string; documentName: string };
      await req(ctx, "DELETE", `/api/resource/${encodeURIComponent(docType)}/${encodeURIComponent(documentName)}`);
      return { success: true };
    },
  });
}
