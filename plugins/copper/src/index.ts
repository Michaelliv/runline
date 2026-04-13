import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.copper.com/developer_api/v1";

async function apiRequest(
  apiKey: string,
  email: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-PW-AccessToken": apiKey,
      "X-PW-Application": "developer_api",
      "X-PW-UserEmail": email,
    },
  };
  if (body && Object.keys(body).length > 0) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${endpoint}`, opts);
  if (!res.ok) throw new Error(`Copper API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return { success: true };
}

async function searchAll(
  apiKey: string,
  email: string,
  endpoint: string,
  body?: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let page = 1;
  const size = 200;
  while (true) {
    const data = (await apiRequest(apiKey, email, "POST", endpoint, {
      ...body,
      page_number: page,
      page_size: size,
    })) as unknown[];
    if (!Array.isArray(data)) break;
    results.push(...data);
    if (limit && results.length >= limit) return results.slice(0, limit);
    if (data.length < size) break;
    page++;
  }
  return results;
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    apiKey: ctx.connection.config.apiKey as string,
    email: ctx.connection.config.email as string,
  };
}

function registerCrud(
  rl: RunlinePluginAPI,
  resource: string,
  endpoint: string,
  idParam: string,
  nameRequired: boolean,
  extraCreateFields?: Record<string, { type: string; required: boolean; description: string }>,
) {
  rl.registerAction(`${resource}.create`, {
    description: `Create a ${resource}`,
    inputSchema: {
      ...(nameRequired ? { name: { type: "string", required: true, description: `${resource} name` } } : {}),
      ...extraCreateFields,
    },
    async execute(input, ctx) {
      const { apiKey, email } = getConn(ctx);
      return apiRequest(apiKey, email, "POST", endpoint, (input ?? {}) as Record<string, unknown>);
    },
  });

  rl.registerAction(`${resource}.get`, {
    description: `Get a ${resource} by ID`,
    inputSchema: { [idParam]: { type: "string", required: true, description: `${resource} ID` } },
    async execute(input, ctx) {
      const { apiKey, email } = getConn(ctx);
      return apiRequest(apiKey, email, "GET", `${endpoint}/${(input as Record<string, string>)[idParam]}`);
    },
  });

  rl.registerAction(`${resource}.list`, {
    description: `Search/list ${resource}s`,
    inputSchema: { limit: { type: "number", required: false, description: "Max results" } },
    async execute(input, ctx) {
      const { apiKey, email } = getConn(ctx);
      const { limit } = (input ?? {}) as { limit?: number };
      return searchAll(apiKey, email, `${endpoint}/search`, undefined, limit);
    },
  });

  rl.registerAction(`${resource}.update`, {
    description: `Update a ${resource}`,
    inputSchema: {
      [idParam]: { type: "string", required: true, description: `${resource} ID` },
    },
    async execute(input, ctx) {
      const { apiKey, email } = getConn(ctx);
      const { [idParam]: id, ...body } = input as Record<string, unknown>;
      return apiRequest(apiKey, email, "PUT", `${endpoint}/${id}`, body);
    },
  });

  rl.registerAction(`${resource}.delete`, {
    description: `Delete a ${resource}`,
    inputSchema: { [idParam]: { type: "string", required: true, description: `${resource} ID` } },
    async execute(input, ctx) {
      const { apiKey, email } = getConn(ctx);
      return apiRequest(apiKey, email, "DELETE", `${endpoint}/${(input as Record<string, string>)[idParam]}`);
    },
  });
}

export default function copper(rl: RunlinePluginAPI) {
  rl.setName("copper");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Copper API key", env: "COPPER_API_KEY" },
    email: { type: "string", required: true, description: "Copper user email", env: "COPPER_EMAIL" },
  });

  // CRUD resources
  registerCrud(rl, "company", "/companies", "companyId", true);
  registerCrud(rl, "lead", "/leads", "leadId", true);
  registerCrud(rl, "opportunity", "/opportunities", "opportunityId", true, {
    customerSourceId: { type: "string", required: true, description: "Customer source ID" },
    primaryContactId: { type: "string", required: true, description: "Primary contact ID" },
  });
  registerCrud(rl, "person", "/people", "personId", true);
  registerCrud(rl, "project", "/projects", "projectId", true);
  registerCrud(rl, "task", "/tasks", "taskId", true);

  // Read-only resources
  rl.registerAction("customerSource.list", {
    description: "List customer sources",
    inputSchema: { limit: { type: "number", required: false, description: "Max results" } },
    async execute(input, ctx) {
      const { apiKey, email } = getConn(ctx);
      const data = (await apiRequest(apiKey, email, "GET", "/customer_sources")) as unknown[];
      const { limit } = (input ?? {}) as { limit?: number };
      if (limit) return data.slice(0, limit);
      return data;
    },
  });

  rl.registerAction("user.list", {
    description: "List users",
    inputSchema: { limit: { type: "number", required: false, description: "Max results" } },
    async execute(input, ctx) {
      const { apiKey, email } = getConn(ctx);
      const { limit } = (input ?? {}) as { limit?: number };
      return searchAll(apiKey, email, "/users/search", undefined, limit);
    },
  });
}
