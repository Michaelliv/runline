import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  domain: string,
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`https://${domain}.freshservice.com/api/v2${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:X`)}`,
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Freshservice API error ${res.status}: ${await res.text()}`);
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
  singularKey: string,
  opts?: { extraCreateFields?: Record<string, { type: string; required: boolean; description: string }>; noDelete?: boolean },
) {
  rl.registerAction(`${resource}.create`, {
    description: `Create a ${resource}`,
    inputSchema: {
      ...(opts?.extraCreateFields ?? {}),
      properties: { type: "object", required: true, description: `${resource} properties as key-value pairs` },
    },
    async execute(input, ctx) {
      const { properties, ...rest } = input as Record<string, unknown>;
      const body = { ...(properties as Record<string, unknown>), ...rest };
      return unwrap(await req(ctx, "POST", apiPath, body));
    },
  });

  rl.registerAction(`${resource}.get`, {
    description: `Get a ${resource} by ID`,
    inputSchema: { id: { type: "number", required: true, description: `${resource} ID` } },
    async execute(input, ctx) {
      return unwrap(await req(ctx, "GET", `${apiPath}/${(input as { id: number }).id}`));
    },
  });

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

  rl.registerAction(`${resource}.update`, {
    description: `Update a ${resource}`,
    inputSchema: {
      id: { type: "number", required: true, description: `${resource} ID` },
      properties: { type: "object", required: true, description: "Fields to update" },
    },
    async execute(input, ctx) {
      const { id, properties } = input as { id: number; properties: Record<string, unknown> };
      return unwrap(await req(ctx, "PUT", `${apiPath}/${id}`, properties));
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

export default function freshservice(rl: RunlinePluginAPI) {
  rl.setName("freshservice");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    domain: { type: "string", required: true, description: "Freshservice subdomain (e.g. 'mycompany')", env: "FRESHSERVICE_DOMAIN" },
    apiKey: { type: "string", required: true, description: "Freshservice API key", env: "FRESHSERVICE_API_KEY" },
  });

  // 16 resources, all CRUD
  registerCrud(rl, "agent", "/agents", "agent");
  registerCrud(rl, "agentGroup", "/groups", "group");
  registerCrud(rl, "announcement", "/announcements", "announcement");
  registerCrud(rl, "asset", "/assets", "asset");
  registerCrud(rl, "assetType", "/asset_types", "asset_type");
  registerCrud(rl, "change", "/changes", "change");
  registerCrud(rl, "department", "/departments", "department");
  registerCrud(rl, "location", "/locations", "location");
  registerCrud(rl, "problem", "/problems", "problem");
  registerCrud(rl, "product", "/products", "product");
  registerCrud(rl, "release", "/releases", "release");
  registerCrud(rl, "requester", "/requesters", "requester");
  registerCrud(rl, "requesterGroup", "/requester_groups", "requester_group");
  registerCrud(rl, "software", "/applications", "application");
  registerCrud(rl, "ticket", "/tickets", "ticket");

  // agentRole is read-only (get + list only)
  rl.registerAction("agentRole.get", {
    description: "Get an agent role by ID",
    inputSchema: { id: { type: "number", required: true, description: "Role ID" } },
    async execute(input, ctx) {
      return unwrap(await req(ctx, "GET", `/roles/${(input as { id: number }).id}`));
    },
  });

  rl.registerAction("agentRole.list", {
    description: "List agent roles",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      page: { type: "number", required: false, description: "Page number" },
    },
    async execute(input, ctx) {
      const { limit, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.per_page = limit;
      if (page) qs.page = page;
      return unwrap(await req(ctx, "GET", "/roles", undefined, qs));
    },
  });
}
