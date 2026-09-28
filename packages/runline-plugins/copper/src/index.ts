import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { copperCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, copperCredential, "copper", {
    target: "api",
    path,
    method,
    headers: {
      "X-PW-Application": "developer_api",
      "X-PW-UserEmail": String(ctx.connection.config.email ?? ""),
    },
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

async function searchAll(
  ctx: ActionContext,
  path: string,
  body?: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let page = 1;
  const size = 200;
  while (true) {
    const data = (await apiRequest(ctx, "POST", path, {
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

function registerCrud(
  rl: RunlinePluginAPI,
  resource: string,
  endpoint: string,
  idParam: string,
  nameRequired: boolean,
  extraCreateFields?: Record<
    string,
    { type: string; required: boolean; description: string }
  >,
) {
  rl.registerAction(`${resource}.create`, {
    access: "write",
    description: `Create a ${resource}`,
    inputSchema: {
      ...(nameRequired
        ? {
            name: {
              type: "string",
              required: true,
              description: `${resource} name`,
            },
          }
        : {}),
      ...extraCreateFields,
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "POST",
        endpoint,
        (input ?? {}) as Record<string, unknown>,
      );
    },
  });

  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource} by ID`,
    inputSchema: {
      [idParam]: {
        type: "string",
        required: true,
        description: `${resource} ID`,
      },
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `${endpoint}/${seg((input as Record<string, string>)[idParam])}`,
      );
    },
  });

  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `Search/list ${resource}s`,
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      return searchAll(ctx, `${endpoint}/search`, undefined, limit);
    },
  });

  rl.registerAction(`${resource}.update`, {
    access: "write",
    description: `Update a ${resource}`,
    inputSchema: {
      [idParam]: {
        type: "string",
        required: true,
        description: `${resource} ID`,
      },
    },
    async execute(input, ctx) {
      const { [idParam]: id, ...body } = input as Record<string, unknown>;
      return apiRequest(ctx, "PUT", `${endpoint}/${seg(id)}`, body);
    },
  });

  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: {
      [idParam]: {
        type: "string",
        required: true,
        description: `${resource} ID`,
      },
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "DELETE",
        `${endpoint}/${seg((input as Record<string, string>)[idParam])}`,
      );
    },
  });
}

export default function copper(rl: RunlinePluginAPI) {
  rl.setName("copper");
  rl.setVersion("0.1.0");
  rl.setCredential(copperCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Copper API key",
      env: "COPPER_API_KEY",
    },
    email: {
      type: "string",
      required: true,
      description: "Copper user email",
      env: "COPPER_EMAIL",
    },
  });

  // CRUD resources
  registerCrud(rl, "company", "companies", "companyId", true);
  registerCrud(rl, "lead", "leads", "leadId", true);
  registerCrud(rl, "opportunity", "opportunities", "opportunityId", true, {
    customerSourceId: {
      type: "string",
      required: true,
      description: "Customer source ID",
    },
    primaryContactId: {
      type: "string",
      required: true,
      description: "Primary contact ID",
    },
  });
  registerCrud(rl, "person", "people", "personId", true);
  registerCrud(rl, "project", "projects", "projectId", true);
  registerCrud(rl, "task", "tasks", "taskId", true);

  // Read-only resources
  rl.registerAction("customerSource.list", {
    access: "read",
    description: "List customer sources",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const data = (await apiRequest(
        ctx,
        "GET",
        "customer_sources",
      )) as unknown[];
      const { limit } = (input ?? {}) as { limit?: number };
      if (limit) return data.slice(0, limit);
      return data;
    },
  });

  rl.registerAction("user.list", {
    access: "read",
    description: "List users",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      return searchAll(ctx, "users/search", undefined, limit);
    },
  });
}
