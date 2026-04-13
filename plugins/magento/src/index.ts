import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  host: string, token: string, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${host}${endpoint}`);
  if (qs) {
    // Magento uses nested query params like search_criteria[page_size]=10
    function flatten(obj: unknown, prefix = ""): void {
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          flatten(v, prefix ? `${prefix}[${k}]` : k);
        }
      } else if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          flatten(obj[i], `${prefix}[${i}]`);
        }
      } else if (obj !== undefined && obj !== null) {
        url.searchParams.set(prefix, String(obj));
      }
    }
    flatten(qs);
  }
  const opts: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Magento API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function searchAll(
  host: string, token: string, endpoint: string,
  searchCriteria: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  searchCriteria.page_size = 100;
  let currentPage = 1;
  let totalCount = Infinity;
  while (all.length < totalCount) {
    searchCriteria.current_page = currentPage;
    const data = (await apiRequest(host, token, "GET", endpoint, undefined, { search_criteria: searchCriteria })) as Record<string, unknown>;
    totalCount = (data.total_count as number) ?? 0;
    const items = data.items as unknown[];
    if (items) all.push(...items);
    else break;
    currentPage++;
  }
  return all;
}

export default function magento(rl: RunlinePluginAPI) {
  rl.setName("magento");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    host: { type: "string", required: true, description: "Magento store URL (e.g. https://mystore.com)", env: "MAGENTO_HOST" },
    accessToken: { type: "string", required: true, description: "Integration access token", env: "MAGENTO_ACCESS_TOKEN" },
  });

  const conn = (ctx: { connection: { config: Record<string, unknown> } }) => ({
    host: (ctx.connection.config.host as string).replace(/\/$/, ""),
    token: ctx.connection.config.accessToken as string,
  });

  // ── Customer ────────────────────────────────────────

  rl.registerAction("customer.create", {
    description: "Create a customer",
    inputSchema: {
      email: { type: "string", required: true },
      firstname: { type: "string", required: true },
      lastname: { type: "string", required: true },
      password: { type: "string", required: false },
      addresses: { type: "array", required: false, description: "Array of address objects (street as string, city, postcode, country_id, firstname, lastname, telephone required)" },
      customAttributes: { type: "array", required: false, description: "Array of {attribute_code, value} objects" },
      additionalFields: { type: "object", required: false, description: "middlename, prefix, suffix, dob, gender (1=male,2=female,3=unspecified), group_id, store_id, website_id, etc." },
    },
    async execute(input, ctx) {
      const { email, firstname, lastname, password, addresses, customAttributes, additionalFields } = input as Record<string, unknown>;
      const { host, token } = conn(ctx);
      const customer: Record<string, unknown> = { email, firstname, lastname };
      if (addresses && Array.isArray(addresses)) {
        customer.addresses = (addresses as Array<Record<string, unknown>>).map((a) => ({
          ...a,
          street: Array.isArray(a.street) ? a.street : [a.street],
        }));
      }
      if (customAttributes) customer.custom_attributes = customAttributes;
      if (additionalFields) Object.assign(customer, additionalFields);
      const body: Record<string, unknown> = { customer };
      if (password) body.password = password;
      return apiRequest(host, token, "POST", "/rest/V1/customers", body);
    },
  });

  rl.registerAction("customer.get", {
    description: "Get a customer by ID",
    inputSchema: { customerId: { type: "number", required: true } },
    async execute(input, ctx) {
      const { host, token } = conn(ctx);
      return apiRequest(host, token, "GET", `/rest/default/V1/customers/${(input as { customerId: number }).customerId}`);
    },
  });

  rl.registerAction("customer.list", {
    description: "Search/list customers using Magento search_criteria",
    inputSchema: {
      searchCriteria: { type: "object", required: false, description: "Magento search_criteria object (filter_groups, sort_orders, page_size). Omit for all." },
      limit: { type: "number", required: false, description: "Max results (if not using searchCriteria)" },
    },
    async execute(input, ctx) {
      const { searchCriteria, limit } = (input ?? {}) as Record<string, unknown>;
      const { host, token } = conn(ctx);
      if (searchCriteria) {
        const data = await apiRequest(host, token, "GET", "/rest/default/V1/customers/search", undefined, { search_criteria: searchCriteria }) as Record<string, unknown>;
        return data.items;
      }
      if (limit) {
        const data = await apiRequest(host, token, "GET", "/rest/default/V1/customers/search", undefined, { search_criteria: { page_size: limit } }) as Record<string, unknown>;
        return data.items;
      }
      return searchAll(host, token, "/rest/default/V1/customers/search");
    },
  });

  rl.registerAction("customer.update", {
    description: "Update a customer",
    inputSchema: {
      customerId: { type: "number", required: true },
      email: { type: "string", required: true },
      firstname: { type: "string", required: true },
      lastname: { type: "string", required: true },
      updateFields: { type: "object", required: false, description: "Fields to update (middlename, dob, gender, group_id, etc.)" },
      addresses: { type: "array", required: false },
      customAttributes: { type: "array", required: false },
    },
    async execute(input, ctx) {
      const { customerId, email, firstname, lastname, updateFields, addresses, customAttributes } = input as Record<string, unknown>;
      const { host, token } = conn(ctx);
      const customer: Record<string, unknown> = { email, firstname, lastname, id: customerId, website_id: 0 };
      if (addresses && Array.isArray(addresses)) {
        customer.addresses = (addresses as Array<Record<string, unknown>>).map((a) => ({
          ...a,
          street: Array.isArray(a.street) ? a.street : [a.street],
        }));
      }
      if (customAttributes) customer.custom_attributes = customAttributes;
      if (updateFields) Object.assign(customer, updateFields);
      return apiRequest(host, token, "PUT", `/rest/V1/customers/${customerId}`, { customer });
    },
  });

  rl.registerAction("customer.delete", {
    description: "Delete a customer",
    inputSchema: { customerId: { type: "number", required: true } },
    async execute(input, ctx) {
      const { host, token } = conn(ctx);
      await apiRequest(host, token, "DELETE", `/rest/default/V1/customers/${(input as { customerId: number }).customerId}`);
      return { success: true };
    },
  });

  // ── Invoice ─────────────────────────────────────────

  rl.registerAction("invoice.create", {
    description: "Create an invoice for an order",
    inputSchema: { orderId: { type: "number", required: true } },
    async execute(input, ctx) {
      const { host, token } = conn(ctx);
      await apiRequest(host, token, "POST", `/rest/default/V1/order/${(input as { orderId: number }).orderId}/invoice`);
      return { success: true };
    },
  });

  // ── Order ───────────────────────────────────────────

  rl.registerAction("order.get", {
    description: "Get an order by ID",
    inputSchema: { orderId: { type: "number", required: true } },
    async execute(input, ctx) {
      const { host, token } = conn(ctx);
      return apiRequest(host, token, "GET", `/rest/default/V1/orders/${(input as { orderId: number }).orderId}`);
    },
  });

  rl.registerAction("order.list", {
    description: "Search/list orders",
    inputSchema: {
      searchCriteria: { type: "object", required: false, description: "Magento search_criteria object" },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const { searchCriteria, limit } = (input ?? {}) as Record<string, unknown>;
      const { host, token } = conn(ctx);
      if (searchCriteria) {
        const data = await apiRequest(host, token, "GET", "/rest/default/V1/orders", undefined, { search_criteria: searchCriteria }) as Record<string, unknown>;
        return data.items;
      }
      if (limit) {
        const data = await apiRequest(host, token, "GET", "/rest/default/V1/orders", undefined, { search_criteria: { page_size: limit } }) as Record<string, unknown>;
        return data.items;
      }
      return searchAll(host, token, "/rest/default/V1/orders");
    },
  });

  rl.registerAction("order.cancel", {
    description: "Cancel an order",
    inputSchema: { orderId: { type: "number", required: true } },
    async execute(input, ctx) {
      const { host, token } = conn(ctx);
      await apiRequest(host, token, "POST", `/rest/default/V1/orders/${(input as { orderId: number }).orderId}/cancel`);
      return { success: true };
    },
  });

  rl.registerAction("order.ship", {
    description: "Ship an order",
    inputSchema: { orderId: { type: "number", required: true } },
    async execute(input, ctx) {
      const { host, token } = conn(ctx);
      await apiRequest(host, token, "POST", `/rest/default/V1/order/${(input as { orderId: number }).orderId}/ship`);
      return { success: true };
    },
  });

  // ── Product ─────────────────────────────────────────

  rl.registerAction("product.create", {
    description: "Create a product",
    inputSchema: {
      sku: { type: "string", required: true },
      name: { type: "string", required: true },
      attributeSetId: { type: "number", required: true },
      price: { type: "number", required: true },
      additionalFields: { type: "object", required: false, description: "status (1=enabled,2=disabled), visibility (1-4), weight, type_id, etc." },
      customAttributes: { type: "array", required: false, description: "Array of {attribute_code, value}" },
    },
    async execute(input, ctx) {
      const { sku, name, attributeSetId, price, additionalFields, customAttributes } = input as Record<string, unknown>;
      const { host, token } = conn(ctx);
      const product: Record<string, unknown> = { sku, name, attribute_set_id: attributeSetId, price };
      if (customAttributes) product.custom_attributes = customAttributes;
      if (additionalFields) Object.assign(product, additionalFields);
      return apiRequest(host, token, "POST", "/rest/default/V1/products", { product });
    },
  });

  rl.registerAction("product.get", {
    description: "Get a product by SKU",
    inputSchema: { sku: { type: "string", required: true } },
    async execute(input, ctx) {
      const { host, token } = conn(ctx);
      return apiRequest(host, token, "GET", `/rest/default/V1/products/${encodeURIComponent((input as { sku: string }).sku)}`);
    },
  });

  rl.registerAction("product.list", {
    description: "Search/list products",
    inputSchema: {
      searchCriteria: { type: "object", required: false },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const { searchCriteria, limit } = (input ?? {}) as Record<string, unknown>;
      const { host, token } = conn(ctx);
      if (searchCriteria) {
        const data = await apiRequest(host, token, "GET", "/rest/default/V1/products", undefined, { search_criteria: searchCriteria }) as Record<string, unknown>;
        return data.items;
      }
      if (limit) {
        const data = await apiRequest(host, token, "GET", "/rest/default/V1/products", undefined, { search_criteria: { page_size: limit } }) as Record<string, unknown>;
        return data.items;
      }
      return searchAll(host, token, "/rest/default/V1/products");
    },
  });

  rl.registerAction("product.update", {
    description: "Update a product by SKU",
    inputSchema: {
      sku: { type: "string", required: true },
      updateFields: { type: "object", required: true, description: "Fields to update (name, price, status, visibility, weight, attribute_set_id, etc.)" },
      customAttributes: { type: "array", required: false },
    },
    async execute(input, ctx) {
      const { sku, updateFields, customAttributes } = input as Record<string, unknown>;
      const { host, token } = conn(ctx);
      const product: Record<string, unknown> = { sku };
      if (customAttributes) product.custom_attributes = customAttributes;
      Object.assign(product, updateFields);
      return apiRequest(host, token, "PUT", `/rest/default/V1/products/${encodeURIComponent(sku as string)}`, { product });
    },
  });

  rl.registerAction("product.delete", {
    description: "Delete a product by SKU",
    inputSchema: { sku: { type: "string", required: true } },
    async execute(input, ctx) {
      const { host, token } = conn(ctx);
      await apiRequest(host, token, "DELETE", `/rest/default/V1/products/${encodeURIComponent((input as { sku: string }).sku)}`);
      return { success: true };
    },
  });
}
