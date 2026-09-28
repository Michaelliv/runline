import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { zohoCredential } from "./credentials.js";

function api(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, zohoCredential, "zoho", {
    target: "api",
    path: endpoint,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: { data: [body] } } : {}),
  });
}

const MODULES: Record<string, string> = {
  account: "Accounts",
  contact: "Contacts",
  deal: "Deals",
  invoice: "Invoices",
  lead: "Leads",
  product: "Products",
  purchaseOrder: "Purchase_Orders",
  salesOrder: "Sales_Orders",
  vendor: "Vendors",
  quote: "Quotes",
};

function registerCrmResource(rl: RunlinePluginAPI, resource: string) {
  const mod = MODULES[resource];

  rl.registerAction(`${resource}.create`, {
    access: "write",
    description: `Create a ${resource}`,
    inputSchema: {
      data: { type: "object", required: true, description: "Record fields" },
    },
    async execute(input, ctx) {
      const data = (await api(
        ctx,
        "POST",
        `${mod}`,
        (input as Record<string, unknown>).data as Record<string, unknown>,
      )) as Record<string, unknown>;
      return data.data;
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
        `${mod}/${pathSegment((input as Record<string, unknown>).id)}`,
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `List ${mod}`,
    inputSchema: {
      limit: { type: "number", required: false },
      fields: {
        type: "string",
        required: false,
        description: "Comma-separated field names",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.per_page = p.limit;
      if (p.fields) qs.fields = p.fields;
      const data = (await api(ctx, "GET", `${mod}`, undefined, qs)) as Record<
        string,
        unknown
      >;
      return data.data ?? [];
    },
  });

  rl.registerAction(`${resource}.update`, {
    access: "write",
    description: `Update a ${resource}`,
    inputSchema: {
      id: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body = { ...(p.data as Record<string, unknown>), id: p.id };
      const data = (await api(ctx, "PUT", `${mod}`, body)) as Record<
        string,
        unknown
      >;
      return data.data;
    },
  });

  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(ctx, "DELETE", `${mod}`, undefined, {
        ids: (input as Record<string, unknown>).id,
      })) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction(`${resource}.upsert`, {
    access: "write",
    description: `Upsert a ${resource}`,
    inputSchema: {
      data: { type: "object", required: true },
      duplicateCheckFields: {
        type: "string",
        required: false,
        description: "Comma-separated field names for duplicate check",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body = p.data as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.duplicateCheckFields) {
        body.duplicate_check_fields = (p.duplicateCheckFields as string)
          .split(",")
          .map((f) => f.trim());
      }
      const data = (await api(ctx, "POST", `${mod}/upsert`, body)) as Record<
        string,
        unknown
      >;
      return data.data;
    },
  });
}

export default function zoho(rl: RunlinePluginAPI) {
  rl.setName("zoho");
  rl.setVersion("0.1.0");
  rl.setCredential(zohoCredential);
  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Zoho OAuth2 access token",
      env: "ZOHO_ACCESS_TOKEN",
    },
    apiDomain: {
      type: "string",
      required: false,
      description: "API domain (default: https://www.zohoapis.com)",
      env: "ZOHO_API_DOMAIN",
    },
  });

  for (const resource of Object.keys(MODULES)) {
    registerCrmResource(rl, resource);
  }
}
