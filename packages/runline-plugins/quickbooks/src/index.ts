import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { quickbooksCredential } from "./credentials.js";

function api(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, quickbooksCredential, "quickbooks", {
    target: "api",
    path: endpoint,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

function capitalCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function registerQbResource(rl: RunlinePluginAPI, resource: string) {
  const cap = capitalCase(resource);

  rl.registerAction(`${resource}.create`, {
    access: "write",
    description: `Create a ${resource}`,
    inputSchema: { data: { type: "object", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "POST",
        resource,
        (input as Record<string, unknown>).data as Record<string, unknown>,
      );
    },
  });

  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource} by ID`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(
        ctx,
        "GET",
        `${resource}/${pathSegment((input as Record<string, unknown>).id)}`,
      )) as Record<string, unknown>;
      return data[cap];
    },
  });

  rl.registerAction(`${resource}.query`, {
    access: "read",
    description: `Query ${resource}s (SQL-like)`,
    inputSchema: {
      query: {
        type: "string",
        required: false,
        description: `WHERE clause (default: SELECT * FROM ${cap})`,
      },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      let q = `SELECT * FROM ${cap}`;
      if (p.query) q += ` ${p.query}`;
      if (p.limit) q += ` MAXRESULTS ${p.limit}`;
      const data = (await api(ctx, "GET", "query", undefined, {
        query: q,
      })) as Record<string, unknown>;
      return (data.QueryResponse as Record<string, unknown>)?.[cap] ?? [];
    },
  });

  rl.registerAction(`${resource}.update`, {
    access: "write",
    description: `Update a ${resource} (must include Id and SyncToken)`,
    inputSchema: { data: { type: "object", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "POST",
        resource,
        (input as Record<string, unknown>).data as Record<string, unknown>,
      );
    },
  });

  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: {
      id: { type: "string", required: true },
      syncToken: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "POST",
        resource,
        { Id: p.id, SyncToken: p.syncToken },
        { operation: "delete" },
      );
    },
  });
}

export default function quickbooks(rl: RunlinePluginAPI) {
  rl.setName("quickbooks");
  rl.setVersion("0.1.0");
  rl.setCredential(quickbooksCredential);
  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "QuickBooks OAuth2 access token",
      env: "QUICKBOOKS_ACCESS_TOKEN",
    },
    companyId: {
      type: "string",
      required: true,
      description: "QuickBooks Company/Realm ID",
      env: "QUICKBOOKS_COMPANY_ID",
    },
    sandbox: {
      type: "boolean",
      required: false,
      description: "Use sandbox environment",
      env: "QUICKBOOKS_SANDBOX",
    },
  });

  for (const resource of [
    "bill",
    "customer",
    "employee",
    "estimate",
    "invoice",
    "item",
    "payment",
    "purchase",
    "vendor",
  ]) {
    registerQbResource(rl, resource);
  }
}
