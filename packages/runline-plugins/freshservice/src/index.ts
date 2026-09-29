import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { freshserviceCredential } from "./credentials.js";

function req(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, freshserviceCredential, "freshservice", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: body }
      : {}),
  });
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
  opts?: {
    extraCreateFields?: Record<
      string,
      { type: string; required: boolean; description: string }
    >;
    noDelete?: boolean;
  },
) {
  rl.registerAction(`${resource}.create`, {
    access: "write",
    description: `Create a ${resource}`,
    inputSchema: {
      ...(opts?.extraCreateFields ?? {}),
      properties: {
        type: "object",
        required: true,
        description: `${resource} properties as key-value pairs`,
      },
    },
    async execute(input, ctx) {
      const { properties, ...rest } = input as Record<string, unknown>;
      const body = { ...(properties as Record<string, unknown>), ...rest };
      return unwrap(await req(ctx, "POST", apiPath, body));
    },
  });

  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource} by ID`,
    inputSchema: {
      id: { type: "number", required: true, description: `${resource} ID` },
    },
    async execute(input, ctx) {
      return unwrap(
        await req(
          ctx,
          "GET",
          `${apiPath}/${pathSegment((input as { id: number }).id)}`,
        ),
      );
    },
  });

  rl.registerAction(`${resource}.list`, {
    access: "read",
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
    access: "write",
    description: `Update a ${resource}`,
    inputSchema: {
      id: { type: "number", required: true, description: `${resource} ID` },
      properties: {
        type: "object",
        required: true,
        description: "Fields to update",
      },
    },
    async execute(input, ctx) {
      const { id, properties } = input as {
        id: number;
        properties: Record<string, unknown>;
      };
      return unwrap(
        await req(ctx, "PUT", `${apiPath}/${pathSegment(id)}`, properties),
      );
    },
  });

  if (!opts?.noDelete) {
    rl.registerAction(`${resource}.delete`, {
      access: "write",
      description: `Delete a ${resource}`,
      inputSchema: {
        id: { type: "number", required: true, description: `${resource} ID` },
      },
      async execute(input, ctx) {
        await req(
          ctx,
          "DELETE",
          `${apiPath}/${pathSegment((input as { id: number }).id)}`,
        );
        return { success: true };
      },
    });
  }
}

export default function freshservice(rl: RunlinePluginAPI) {
  rl.setName("freshservice");
  rl.setVersion("0.1.0");
  rl.setCredential(freshserviceCredential);

  rl.setConnectionSchema({
    domain: {
      type: "string",
      required: true,
      description: "Freshservice subdomain (e.g. 'mycompany')",
      env: "FRESHSERVICE_DOMAIN",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "Freshservice API key",
      env: "FRESHSERVICE_API_KEY",
    },
  });

  // 15 resources, all CRUD
  registerCrud(rl, "agent", "agents");
  registerCrud(rl, "agentGroup", "groups");
  registerCrud(rl, "announcement", "announcements");
  registerCrud(rl, "asset", "assets");
  registerCrud(rl, "assetType", "asset_types");
  registerCrud(rl, "change", "changes");
  registerCrud(rl, "department", "departments");
  registerCrud(rl, "location", "locations");
  registerCrud(rl, "problem", "problems");
  registerCrud(rl, "product", "products");
  registerCrud(rl, "release", "releases");
  registerCrud(rl, "requester", "requesters");
  registerCrud(rl, "requesterGroup", "requester_groups");
  registerCrud(rl, "software", "applications");
  registerCrud(rl, "ticket", "tickets");

  // agentRole is read-only (get + list only)
  rl.registerAction("agentRole.get", {
    access: "read",
    description: "Get an agent role by ID",
    inputSchema: {
      id: { type: "number", required: true, description: "Role ID" },
    },
    async execute(input, ctx) {
      return unwrap(
        await req(
          ctx,
          "GET",
          `roles/${pathSegment((input as { id: number }).id)}`,
        ),
      );
    },
  });

  rl.registerAction("agentRole.list", {
    access: "read",
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
      return unwrap(await req(ctx, "GET", "roles", undefined, qs));
    },
  });
}
