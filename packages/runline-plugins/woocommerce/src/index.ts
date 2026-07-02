import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return {
    url: (c.url as string).replace(/\/$/, ""),
    consumerKey: c.consumerKey as string,
    consumerSecret: c.consumerSecret as string,
  };
}

async function apiRequest(
  conn: ReturnType<typeof getConn>,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${conn.url}/wp-json/wc/v3${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${conn.consumerKey}:${conn.consumerSecret}`)}`,
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok)
    throw new Error(`WooCommerce error ${res.status}: ${await res.text()}`);
  return res.json();
}

function registerCrud(
  rl: RunlinePluginAPI,
  resource: string,
  plural: string,
  conn: (ctx: {
    connection: { config: Record<string, unknown> };
  }) => ReturnType<typeof getConn>,
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
      return apiRequest(
        conn(ctx),
        "POST",
        `/${plural}`,
        input as Record<string, unknown>,
      );
    },
  });

  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource} by ID`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        conn(ctx),
        "GET",
        `/${plural}/${(input as Record<string, unknown>).id}`,
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
      return apiRequest(conn(ctx), "GET", `/${plural}`, undefined, qs);
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
        conn(ctx),
        "PUT",
        `/${plural}/${p.id}`,
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
        conn(ctx),
        "DELETE",
        `/${plural}/${(input as Record<string, unknown>).id}`,
        undefined,
        { force: "true" },
      );
    },
  });
}

export default function woocommerce(rl: RunlinePluginAPI) {
  rl.setName("woocommerce");
  rl.setVersion("0.1.0");
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

  registerCrud(rl, "product", "products", getConn, {
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

  registerCrud(rl, "order", "orders", getConn, {
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

  registerCrud(rl, "customer", "customers", getConn, {
    email: { type: "string", required: true },
    first_name: { type: "string", required: false },
    last_name: { type: "string", required: false },
  });
}
