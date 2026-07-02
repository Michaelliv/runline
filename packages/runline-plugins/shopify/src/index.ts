import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  const subdomain = c.shopSubdomain as string;
  const base = `https://${subdomain}.myshopify.com/admin/api/2024-07`;
  return { base, accessToken: c.accessToken as string };
}

async function apiRequest(
  conn: { base: string; accessToken: string },
  method: string,
  endpoint: string,
  body?: unknown,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${conn.base}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      "X-Shopify-Access-Token": conn.accessToken,
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok)
    throw new Error(`Shopify error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function paginate(
  conn: { base: string; accessToken: string },
  propertyName: string,
  endpoint: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  let nextUrl: string | undefined;
  do {
    const url = nextUrl ?? `${conn.base}${endpoint}`;
    const u = new URL(url);
    if (!nextUrl && qs) {
      for (const [k, v] of Object.entries(qs)) {
        if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(u.toString(), {
      headers: { "X-Shopify-Access-Token": conn.accessToken },
    });
    if (!res.ok)
      throw new Error(`Shopify error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as Record<string, unknown>;
    all.push(...((data[propertyName] ?? []) as unknown[]));
    nextUrl = undefined;
    const link = res.headers.get("link") ?? "";
    if (link.includes('rel="next"')) {
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      if (match) nextUrl = match[1];
    }
  } while (nextUrl);
  return all;
}

export default function shopify(rl: RunlinePluginAPI) {
  rl.setName("shopify");
  rl.setVersion("0.1.0");

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
      const data = (await apiRequest(getConn(ctx), "POST", "/orders.json", {
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
        getConn(ctx),
        "GET",
        `/orders/${p.orderId}.json`,
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
      const conn = getConn(ctx);
      const qs: Record<string, unknown> = {};
      if (p.status) qs.status = p.status;
      if (p.createdAtMin) qs.created_at_min = p.createdAtMin;
      if (p.createdAtMax) qs.created_at_max = p.createdAtMax;
      if (p.limit) {
        qs.limit = p.limit;
        const d = (await apiRequest(
          conn,
          "GET",
          "/orders.json",
          undefined,
          qs,
        )) as Record<string, unknown>;
        return d.orders;
      }
      return paginate(conn, "orders", "/orders.json", qs);
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
        getConn(ctx),
        "PUT",
        `/orders/${p.orderId}.json`,
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
        getConn(ctx),
        "DELETE",
        `/orders/${(input as Record<string, unknown>).orderId}.json`,
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
      const data = (await apiRequest(getConn(ctx), "POST", "/products.json", {
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
        getConn(ctx),
        "GET",
        `/products/${p.productId}.json`,
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
      const conn = getConn(ctx);
      const qs: Record<string, unknown> = {};
      if (p.title) qs.title = p.title;
      if (p.limit) {
        qs.limit = p.limit;
        const d = (await apiRequest(
          conn,
          "GET",
          "/products.json",
          undefined,
          qs,
        )) as Record<string, unknown>;
        return d.products;
      }
      return paginate(conn, "products", "/products.json", qs);
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
        getConn(ctx),
        "PUT",
        `/products/${productId}.json`,
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
        getConn(ctx),
        "DELETE",
        `/products/${(input as Record<string, unknown>).productId}.json`,
      );
      return { success: true };
    },
  });
}
