import type { RunlinePluginAPI } from "runline";

const V2 = "https://api.pipedrive.com/api/v2";
const V1 = "https://api.pipedrive.com/v1";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return ctx.connection.config.apiToken as string;
}

async function api(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
  version: "v1" | "v2" = "v2",
): Promise<unknown> {
  const base = version === "v1" ? V1 : V2;
  const url = new URL(`${base}${endpoint}`);
  url.searchParams.set("api_token", token);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok)
    throw new Error(`Pipedrive error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as Record<string, unknown>;
  if (json.success === false)
    throw new Error(`Pipedrive: ${JSON.stringify(json)}`);
  return json.data ?? json;
}

async function paginate(
  token: string,
  endpoint: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const results: unknown[] = [];
  qs.limit = 500;
  let cursor: string | undefined;
  do {
    if (cursor) qs.cursor = cursor;
    const url = new URL(`${V2}${endpoint}`);
    url.searchParams.set("api_token", token);
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok)
      throw new Error(`Pipedrive error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as Record<string, unknown>;
    const data = json.data;
    if (Array.isArray(data)) results.push(...data);
    cursor = (json.additional_data as Record<string, unknown> | undefined)
      ?.next_cursor as string | undefined;
    if (!cursor) break;
  } while (true);
  return results;
}

function registerCrud(
  rl: RunlinePluginAPI,
  resource: string,
  endpoint: string,
  opts?: {
    hasSearch?: boolean;
    hasDuplicate?: boolean;
    updateMethod?: string;
    extraCreate?: Record<string, unknown>;
    extraUpdate?: Record<string, unknown>;
  },
) {
  const cap = resource.charAt(0).toUpperCase() + resource.slice(1);
  const updateMethod = opts?.updateMethod ?? "PATCH";

  rl.registerAction(`${resource}.create`, {
    access: "write",
    description: `Create a ${resource}`,
    inputSchema: {
      data: {
        type: "object",
        required: true,
        description: `Fields for the new ${resource}`,
      },
      ...(opts?.extraCreate ?? {}),
    },
    async execute(input, ctx) {
      const t = getConn(ctx);
      return api(
        t,
        "POST",
        endpoint,
        (input as Record<string, unknown>).data as Record<string, unknown>,
      );
    },
  });

  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource}`,
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      const t = getConn(ctx);
      return api(
        t,
        "GET",
        `${endpoint}/${(input as Record<string, unknown>).id}`,
      );
    },
  });

  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `List ${resource}s`,
    inputSchema: {
      limit: { type: "number", required: false },
      filterId: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const t = getConn(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.filterId) qs.filter_id = p.filterId;
      if (p.limit) {
        qs.limit = p.limit;
        return api(t, "GET", endpoint, undefined, qs);
      }
      return paginate(t, endpoint, qs);
    },
  });

  rl.registerAction(`${resource}.update`, {
    access: "write",
    description: `Update a ${resource}`,
    inputSchema: {
      id: { type: "number", required: true },
      data: { type: "object", required: true, description: `Fields to update` },
      ...(opts?.extraUpdate ?? {}),
    },
    async execute(input, ctx) {
      const t = getConn(ctx);
      const p = input as Record<string, unknown>;
      return api(
        t,
        updateMethod,
        `${endpoint}/${p.id}`,
        p.data as Record<string, unknown>,
      );
    },
  });

  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      const t = getConn(ctx);
      await api(
        t,
        "DELETE",
        `${endpoint}/${(input as Record<string, unknown>).id}`,
      );
      return { success: true };
    },
  });

  if (opts?.hasSearch) {
    rl.registerAction(`${resource}.search`, {
      access: "read",
      description: `Search ${resource}s`,
      inputSchema: {
        term: { type: "string", required: true },
        exactMatch: { type: "boolean", required: false },
        limit: { type: "number", required: false },
        fields: {
          type: "string",
          required: false,
          description: "Comma-separated fields to search",
        },
      },
      async execute(input, ctx) {
        const t = getConn(ctx);
        const p = input as Record<string, unknown>;
        const qs: Record<string, unknown> = { term: p.term };
        if (p.exactMatch) qs.exact_match = true;
        if (p.limit) qs.limit = p.limit;
        if (p.fields) qs.fields = p.fields;
        // Search uses v1 API
        const res = (await api(
          t,
          "GET",
          `${endpoint}/search`,
          undefined,
          qs,
          "v1",
        )) as Record<string, unknown>;
        if (Array.isArray(res))
          return (res as Array<Record<string, unknown>>).map(
            (r) => r.item ?? r,
          );
        return res;
      },
    });
  }

  if (opts?.hasDuplicate) {
    rl.registerAction(`${resource}.duplicate`, {
      access: "write",
      description: `Duplicate a ${resource}`,
      inputSchema: { id: { type: "number", required: true } },
      async execute(input, ctx) {
        const t = getConn(ctx);
        return api(
          t,
          "POST",
          `${endpoint}/${(input as Record<string, unknown>).id}/duplicate`,
        );
      },
    });
  }
}

export default function pipedrive(rl: RunlinePluginAPI) {
  rl.setName("pipedrive");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    apiToken: {
      type: "string",
      required: true,
      description: "Pipedrive API token",
      env: "PIPEDRIVE_API_TOKEN",
    },
  });

  // ── Activity ────────────────────────────────────────
  registerCrud(rl, "activity", "/activities");

  // ── Deal ────────────────────────────────────────────
  registerCrud(rl, "deal", "/deals", { hasSearch: true, hasDuplicate: true });

  // ── Deal Product ────────────────────────────────────
  rl.registerAction("dealProduct.add", {
    access: "write",
    description: "Add a product to a deal",
    inputSchema: {
      dealId: { type: "number", required: true },
      productId: { type: "number", required: true },
      itemPrice: { type: "number", required: true },
      quantity: { type: "number", required: true },
      discount: { type: "number", required: false },
      discountType: {
        type: "string",
        required: false,
        description: "percentage or amount",
      },
      comments: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const t = getConn(ctx);
      const { dealId, ...body } = input as Record<string, unknown>;
      return api(t, "POST", `/deals/${dealId}/products`, {
        product_id: body.productId,
        item_price: body.itemPrice,
        quantity: body.quantity,
        ...(body.discount !== undefined ? { discount: body.discount } : {}),
        ...(body.discountType ? { discount_type: body.discountType } : {}),
        ...(body.comments ? { comments: body.comments } : {}),
      });
    },
  });

  rl.registerAction("dealProduct.list", {
    access: "read",
    description: "List products of a deal",
    inputSchema: {
      dealId: { type: "number", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const t = getConn(ctx);
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      return api(t, "GET", `/deals/${p.dealId}/products`, undefined, qs);
    },
  });

  rl.registerAction("dealProduct.update", {
    access: "write",
    description: "Update a product in a deal",
    inputSchema: {
      dealId: { type: "number", required: true },
      productAttachmentId: { type: "number", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const t = getConn(ctx);
      const p = input as Record<string, unknown>;
      return api(
        t,
        "PATCH",
        `/deals/${p.dealId}/products/${p.productAttachmentId}`,
        p.data as Record<string, unknown>,
      );
    },
  });

  rl.registerAction("dealProduct.remove", {
    access: "write",
    description: "Remove a product from a deal",
    inputSchema: {
      dealId: { type: "number", required: true },
      productAttachmentId: { type: "number", required: true },
    },
    async execute(input, ctx) {
      const t = getConn(ctx);
      const p = input as Record<string, unknown>;
      await api(
        t,
        "DELETE",
        `/deals/${p.dealId}/products/${p.productAttachmentId}`,
      );
      return { success: true };
    },
  });

  // ── File (skip create/download — binary) ────────────
  rl.registerAction("file.get", {
    access: "read",
    description: "Get file metadata",
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      return api(
        getConn(ctx),
        "GET",
        `/files/${(input as Record<string, unknown>).id}`,
        undefined,
        undefined,
        "v1",
      );
    },
  });

  rl.registerAction("file.delete", {
    access: "write",
    description: "Delete a file",
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      await api(
        getConn(ctx),
        "DELETE",
        `/files/${(input as Record<string, unknown>).id}`,
        undefined,
        undefined,
        "v1",
      );
      return { success: true };
    },
  });

  rl.registerAction("file.update", {
    access: "write",
    description: "Update file metadata",
    inputSchema: {
      id: { type: "number", required: true },
      name: { type: "string", required: false },
      description: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { id, ...body } = input as Record<string, unknown>;
      return api(getConn(ctx), "PUT", `/files/${id}`, body, undefined, "v1");
    },
  });

  // ── Lead ────────────────────────────────────────────
  registerCrud(rl, "lead", "/leads");

  // ── Note ────────────────────────────────────────────
  registerCrud(rl, "note", "/notes");

  // ── Organization ────────────────────────────────────
  registerCrud(rl, "organization", "/organizations", { hasSearch: true });

  // ── Person ──────────────────────────────────────────
  registerCrud(rl, "person", "/persons", { hasSearch: true });

  // ── Product ─────────────────────────────────────────
  registerCrud(rl, "product", "/products", { hasSearch: true });
}
