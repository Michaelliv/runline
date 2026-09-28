import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { woocommerceCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, woocommerceCredential, "woocommerce", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

function registerCrud(
  rl: RunlinePluginAPI,
  resource: string,
  plural: string,
  createSchema: Record<
    string,
    { type: string; required: boolean; description?: string }
  >,
) {
  rl.registerAction(`${resource}.create`, {
    access: "write",
    description: `Create a ${resource}`,
    inputSchema: createSchema,
    async execute(input, ctx) {
      return apiRequest(ctx, "POST", plural, input as Record<string, unknown>);
    },
  });

  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource} by ID`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `${plural}/${seg((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `List ${plural}`,
    inputSchema: {
      limit: { type: "number", required: false },
      search: { type: "string", required: false },
      status: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.per_page = p.limit;
      if (p.search) qs.search = p.search;
      if (p.status) qs.status = p.status;
      return apiRequest(ctx, "GET", plural, undefined, qs);
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
      return apiRequest(
        ctx,
        "PUT",
        `${plural}/${seg(p.id)}`,
        p.data as Record<string, unknown>,
      );
    },
  });

  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "DELETE",
        `${plural}/${seg((input as Record<string, unknown>).id)}`,
        undefined,
        { force: "true" },
      );
    },
  });
}

export default function woocommerce(rl: RunlinePluginAPI) {
  rl.setName("woocommerce");
  rl.setVersion("0.1.0");
  rl.setCredential(woocommerceCredential);
  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "WooCommerce store URL",
      env: "WOOCOMMERCE_URL",
    },
    consumerKey: {
      type: "string",
      required: true,
      description: "WooCommerce consumer key",
      env: "WOOCOMMERCE_CONSUMER_KEY",
    },
    consumerSecret: {
      type: "string",
      required: true,
      description: "WooCommerce consumer secret",
      env: "WOOCOMMERCE_CONSUMER_SECRET",
    },
  });

  registerCrud(rl, "product", "products", {
    name: { type: "string", required: true },
    type: {
      type: "string",
      required: false,
      description: "simple, grouped, external, variable",
    },
    regular_price: { type: "string", required: false },
    description: { type: "string", required: false },
    sku: { type: "string", required: false },
  });

  registerCrud(rl, "order", "orders", {
    status: {
      type: "string",
      required: false,
      description:
        "pending, processing, on-hold, completed, cancelled, refunded, failed",
    },
    customer_id: { type: "number", required: false },
    line_items: {
      type: "object",
      required: false,
      description: "Array of { product_id, quantity }",
    },
    payment_method: { type: "string", required: false },
  });

  registerCrud(rl, "customer", "customers", {
    email: { type: "string", required: true },
    first_name: { type: "string", required: false },
    last_name: { type: "string", required: false },
  });
}
