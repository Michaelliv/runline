import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialJson,
  credentialOk,
  pathSegment,
  pathWithin,
} from "../../_shared/credentials.js";
import { shopifyCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: unknown,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, shopifyCredential, "shopify", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body !== undefined ? { json: body } : {}),
  });
}

async function paginate(
  ctx: ActionContext,
  propertyName: string,
  path: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  let nextPath: string | undefined;
  do {
    const res = await credentialOk(ctx, shopifyCredential, "shopify", {
      target: "api",
      path: nextPath ?? path,
      ...(nextPath === undefined ? { query: qs } : {}),
    });
    const data = (await res.json()) as Record<string, unknown>;
    all.push(...((data[propertyName] ?? []) as unknown[]));
    nextPath = undefined;
    const link = res.headers.get("link") ?? "";
    if (link.includes('rel="next"')) {
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      // A next page only beneath the store's own Admin API base.
      if (match) nextPath = pathWithin(ctx, shopifyCredential, "api", match[1]);
    }
  } while (nextPath);
  return all;
}

export default function shopify(rl: RunlinePluginAPI) {
  rl.setName("shopify");
  rl.setVersion("0.1.0");
  rl.setCredential(shopifyCredential);

  rl.setConnectionSchema({
    shopSubdomain: {
      type: "string",
      required: true,
      description: "Shopify store subdomain (e.g. mystore)",
      env: "SHOPIFY_SUBDOMAIN",
    },
    accessToken: {
      type: "string",
      required: true,
      description: "Shopify Admin API access token",
      env: "SHOPIFY_ACCESS_TOKEN",
    },
  });

  // ── Order ───────────────────────────────────────────

  rl.registerAction("order.create", {
    access: "write",
    description: "Create an order",
    inputSchema: {
      lineItems: {
        type: "object",
        required: true,
        description: "Array of line item objects [{variant_id, quantity}]",
      },
      email: { type: "string", required: false },
      note: { type: "string", required: false },
      tags: { type: "string", required: false },
      test: {
        type: "boolean",
        required: false,
        description: "Mark as test order (default true)",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const order: Record<string, unknown> = {
        line_items: p.lineItems,
        test: p.test !== false,
      };
      if (p.email) order.email = p.email;
      if (p.note) order.note = p.note;
      if (p.tags) order.tags = p.tags;
      const data = (await apiRequest(ctx, "POST", "orders.json", {
        order,
      })) as Record<string, unknown>;
      return data.order;
    },
  });

  rl.registerAction("order.get", {
    access: "read",
    description: "Get an order by ID",
    inputSchema: {
      orderId: { type: "string", required: true },
      fields: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.fields) qs.fields = p.fields;
      const data = (await apiRequest(
        ctx,
        "GET",
        `orders/${pathSegment(p.orderId)}.json`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.order;
    },
  });

  rl.registerAction("order.list", {
    access: "read",
    description: "List orders",
    inputSchema: {
      status: {
        type: "string",
        required: false,
        description: "open, closed, cancelled, any",
      },
      limit: { type: "number", required: false },
      createdAtMin: { type: "string", required: false },
      createdAtMax: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.status) qs.status = p.status;
      if (p.createdAtMin) qs.created_at_min = p.createdAtMin;
      if (p.createdAtMax) qs.created_at_max = p.createdAtMax;
      if (p.limit) {
        qs.limit = p.limit;
        const d = (await apiRequest(
          ctx,
          "GET",
          "orders.json",
          undefined,
          qs,
        )) as Record<string, unknown>;
        return d.orders;
      }
      return paginate(ctx, "orders", "orders.json", qs);
    },
  });

  rl.registerAction("order.update", {
    access: "write",
    description: "Update an order",
    inputSchema: {
      orderId: { type: "string", required: true },
      note: { type: "string", required: false },
      tags: { type: "string", required: false },
      email: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const order: Record<string, unknown> = {};
      if (p.note !== undefined) order.note = p.note;
      if (p.tags) order.tags = p.tags;
      if (p.email) order.email = p.email;
      const data = (await apiRequest(
        ctx,
        "PUT",
        `orders/${pathSegment(p.orderId)}.json`,
        { order },
      )) as Record<string, unknown>;
      return data.order;
    },
  });

  rl.registerAction("order.delete", {
    access: "write",
    description: "Delete an order",
    inputSchema: { orderId: { type: "string", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `orders/${pathSegment((input as Record<string, unknown>).orderId)}.json`,
      );
      return { success: true };
    },
  });

  // ── Product ─────────────────────────────────────────

  rl.registerAction("product.create", {
    access: "write",
    description: "Create a product",
    inputSchema: {
      title: { type: "string", required: true },
      body_html: { type: "string", required: false },
      vendor: { type: "string", required: false },
      product_type: { type: "string", required: false },
      tags: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(ctx, "POST", "products.json", {
        product: p,
      })) as Record<string, unknown>;
      return data.product;
    },
  });

  rl.registerAction("product.get", {
    access: "read",
    description: "Get a product by ID",
    inputSchema: {
      productId: { type: "string", required: true },
      fields: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.fields) qs.fields = p.fields;
      const data = (await apiRequest(
        ctx,
        "GET",
        `products/${pathSegment(p.productId)}.json`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.product;
    },
  });

  rl.registerAction("product.list", {
    access: "read",
    description: "List products",
    inputSchema: {
      limit: { type: "number", required: false },
      title: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.title) qs.title = p.title;
      if (p.limit) {
        qs.limit = p.limit;
        const d = (await apiRequest(
          ctx,
          "GET",
          "products.json",
          undefined,
          qs,
        )) as Record<string, unknown>;
        return d.products;
      }
      return paginate(ctx, "products", "products.json", qs);
    },
  });

  rl.registerAction("product.update", {
    access: "write",
    description: "Update a product",
    inputSchema: {
      productId: { type: "string", required: true },
      title: { type: "string", required: false },
      body_html: { type: "string", required: false },
      vendor: { type: "string", required: false },
      tags: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const { productId, ...fields } = p;
      const data = (await apiRequest(
        ctx,
        "PUT",
        `products/${pathSegment(productId)}.json`,
        { product: fields },
      )) as Record<string, unknown>;
      return data.product;
    },
  });

  rl.registerAction("product.delete", {
    access: "write",
    description: "Delete a product",
    inputSchema: { productId: { type: "string", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `products/${pathSegment((input as Record<string, unknown>).productId)}.json`,
      );
      return { success: true };
    },
  });
}
