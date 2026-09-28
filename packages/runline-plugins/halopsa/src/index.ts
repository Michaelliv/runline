import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { halopsaCredential } from "./credentials.js";

function req(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
) {
  const json =
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? body
      : undefined;
  return credentialJson(ctx, halopsaCredential, "halopsa", {
    target: "api",
    path,
    method,
    query: qs,
    ...(json !== undefined ? { json } : {}),
  });
}

function registerCrud(rl: RunlinePluginAPI, resource: string, apiPath: string) {
  rl.registerAction(`${resource}.create`, {
    access: "write",
    description: `Create a ${resource}`,
    inputSchema: {
      properties: {
        type: "object",
        required: true,
        description: `${resource} data`,
      },
    },
    async execute(input, ctx) {
      return req(ctx, "POST", apiPath, {
        ...(input as { properties: Record<string, unknown> }).properties,
      });
    },
  });
  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource}`,
    inputSchema: {
      id: { type: "number", required: true, description: `${resource} ID` },
    },
    async execute(input, ctx) {
      return req(
        ctx,
        "GET",
        `${apiPath}/${pathSegment((input as { id: number }).id)}`,
      );
    },
  });
  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `List ${resource}s`,
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      page: { type: "number", required: false, description: "Page" },
    },
    async execute(input, ctx) {
      const { limit, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.count = limit;
      if (page) qs.page_no = page;
      return req(ctx, "GET", apiPath, undefined, qs);
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
      return req(ctx, "PUT", apiPath, { id, ...properties });
    },
  });
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

export default function halopsa(rl: RunlinePluginAPI) {
  rl.setName("halopsa");
  rl.setVersion("0.1.0");
  rl.setCredential(halopsaCredential);

  rl.setConnectionSchema({
    hostingType: {
      type: "string",
      required: false,
      description: "cloud (default) or on-premise",
      default: "cloud",
    },
    authUrl: {
      type: "string",
      required: false,
      description: "Auth server URL (cloud)",
      env: "HALOPSA_AUTH_URL",
    },
    appUrl: {
      type: "string",
      required: false,
      description: "App URL (on-premise)",
      env: "HALOPSA_APP_URL",
    },
    resourceApiUrl: {
      type: "string",
      required: true,
      description: "Resource API URL",
      env: "HALOPSA_API_URL",
    },
    clientId: {
      type: "string",
      required: true,
      description: "OAuth2 client ID",
      env: "HALOPSA_CLIENT_ID",
    },
    clientSecret: {
      type: "string",
      required: true,
      description: "OAuth2 client secret",
      env: "HALOPSA_CLIENT_SECRET",
    },
    scope: {
      type: "string",
      required: false,
      description: "OAuth2 scope (default: all)",
      default: "all",
    },
    tenant: {
      type: "string",
      required: false,
      description: "Tenant (cloud only)",
    },
  });

  registerCrud(rl, "client", "client");
  registerCrud(rl, "site", "site");
  registerCrud(rl, "ticket", "tickets");
  registerCrud(rl, "user", "users");
}
