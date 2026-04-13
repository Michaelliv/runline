import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  domain: string,
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`https://${domain}.myfreshworks.com/crm/sales/api${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Token token=${apiKey}`,
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Freshworks CRM API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return { domain: ctx.connection.config.domain as string, apiKey: ctx.connection.config.apiKey as string };
}

function req(ctx: { connection: { config: Record<string, unknown> } }, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>) {
  const { domain, apiKey } = getConn(ctx);
  return apiRequest(domain, apiKey, method, endpoint, body, qs);
}

function unwrap(data: unknown): unknown {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const keys = Object.keys(data as Record<string, unknown>);
    if (keys.length === 1) return (data as Record<string, unknown>)[keys[0]];
  }
  return data;
}

function registerCrud(
  rl: RunlinePluginAPI,
  resource: string,
  apiPath: string,
  wrapKey: string,
  opts?: { noDelete?: boolean; noGet?: boolean; noList?: boolean },
) {
  rl.registerAction(`${resource}.create`, {
    description: `Create a ${resource}`,
    inputSchema: { properties: { type: "object", required: true, description: `${resource} properties` } },
    async execute(input, ctx) {
      const { properties } = input as { properties: Record<string, unknown> };
      return unwrap(await req(ctx, "POST", apiPath, { [wrapKey]: properties }));
    },
  });

  if (!opts?.noGet) {
    rl.registerAction(`${resource}.get`, {
      description: `Get a ${resource} by ID`,
      inputSchema: { id: { type: "number", required: true, description: `${resource} ID` } },
      async execute(input, ctx) {
        return unwrap(await req(ctx, "GET", `${apiPath}/${(input as { id: number }).id}`));
      },
    });
  }

  if (!opts?.noList) {
    rl.registerAction(`${resource}.list`, {
      description: `List ${resource}s`,
      inputSchema: {
        limit: { type: "number", required: false, description: "Max results" },
        page: { type: "number", required: false, description: "Page number" },
      },
      async execute(input, ctx) {
        const { limit, page } = (input ?? {}) as Record<string, unknown>;
        const qs: Record<string, unknown> = {};
        if (limit) qs.per_page = limit;
        if (page) qs.page = page;
        return unwrap(await req(ctx, "GET", apiPath, undefined, qs));
      },
    });
  }

  rl.registerAction(`${resource}.update`, {
    description: `Update a ${resource}`,
    inputSchema: {
      id: { type: "number", required: true, description: `${resource} ID` },
      properties: { type: "object", required: true, description: "Fields to update" },
    },
    async execute(input, ctx) {
      const { id, properties } = input as { id: number; properties: Record<string, unknown> };
      return unwrap(await req(ctx, "PUT", `${apiPath}/${id}`, { [wrapKey]: properties }));
    },
  });

  if (!opts?.noDelete) {
    rl.registerAction(`${resource}.delete`, {
      description: `Delete a ${resource}`,
      inputSchema: { id: { type: "number", required: true, description: `${resource} ID` } },
      async execute(input, ctx) {
        await req(ctx, "DELETE", `${apiPath}/${(input as { id: number }).id}`);
        return { success: true };
      },
    });
  }
}

export default function freshworksCrm(rl: RunlinePluginAPI) {
  rl.setName("freshworksCrm");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    domain: { type: "string", required: true, description: "Freshworks CRM subdomain", env: "FRESHWORKS_CRM_DOMAIN" },
    apiKey: { type: "string", required: true, description: "Freshworks CRM API key", env: "FRESHWORKS_CRM_API_KEY" },
  });

  registerCrud(rl, "account", "/sales_accounts", "sales_account");
  registerCrud(rl, "appointment", "/appointments", "appointment");
  registerCrud(rl, "contact", "/contacts", "contact");
  registerCrud(rl, "deal", "/deals", "deal");
  registerCrud(rl, "note", "/notes", "note", { noGet: true, noList: true });
  registerCrud(rl, "salesActivity", "/sales_activities", "sales_activity");
  registerCrud(rl, "task", "/tasks", "task");

  // ── Search ──────────────────────────────────────────

  rl.registerAction("search.query", {
    description: "Search across entities using a query string",
    inputSchema: {
      query: { type: "string", required: true, description: "Search query" },
      entities: { type: "string", required: false, description: "Comma-separated entities to search (contact, deal, sales_account)" },
      perPage: { type: "number", required: false, description: "Results per page" },
      page: { type: "number", required: false, description: "Page number" },
    },
    async execute(input, ctx) {
      const { query, entities, perPage, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { q: query };
      if (entities) qs.entities = entities;
      if (perPage) qs.per_page = perPage;
      if (page) qs.page = page;
      return req(ctx, "GET", "/search", undefined, qs);
    },
  });

  rl.registerAction("search.lookup", {
    description: "Lookup a record by field value",
    inputSchema: {
      query: { type: "string", required: true, description: "Value to search" },
      field: { type: "string", required: true, description: "Field to search (e.g. email, name)" },
      entities: { type: "string", required: false, description: "Entity type to search" },
    },
    async execute(input, ctx) {
      const { query, field, entities } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { q: query, f: field };
      if (entities) qs.entities = entities;
      return req(ctx, "GET", "/lookup", undefined, qs);
    },
  });
}
