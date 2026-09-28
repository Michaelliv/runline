import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  answerFailed,
  credentialJson,
  pathSegment,
} from "../../_shared/credentials.js";
import { pipedriveCredential } from "./credentials.js";

async function api(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
  version: "v1" | "v2" = "v2",
): Promise<unknown> {
  const json = (await credentialJson(ctx, pipedriveCredential, "pipedrive", {
    target: version,
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  })) as Record<string, unknown>;
  if (json.success === false)
    throw answerFailed("pipedrive", {
      code: json.errorCode,
      message: json.error,
    });
  return json.data ?? json;
}

async function paginate(
  ctx: ActionContext,
  path: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const results: unknown[] = [];
  qs.limit = 500;
  let cursor: string | undefined;
  do {
    if (cursor) qs.cursor = cursor;
    const json = (await credentialJson(ctx, pipedriveCredential, "pipedrive", {
      target: "v2",
      path,
      query: qs,
    })) as Record<string, unknown>;
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
  const updateMethod = (opts?.updateMethod ?? "PATCH") as HttpMethod;

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
      return api(
        ctx,
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
      return api(
        ctx,
        "GET",
        `${endpoint}/${pathSegment((input as Record<string, unknown>).id)}`,
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
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.filterId) qs.filter_id = p.filterId;
      if (p.limit) {
        qs.limit = p.limit;
        return api(ctx, "GET", endpoint, undefined, qs);
      }
      return paginate(ctx, endpoint, qs);
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
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        updateMethod,
        `${endpoint}/${pathSegment(p.id)}`,
        p.data as Record<string, unknown>,
      );
    },
  });

  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `${endpoint}/${pathSegment((input as Record<string, unknown>).id)}`,
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
        const p = input as Record<string, unknown>;
        const qs: Record<string, unknown> = { term: p.term };
        if (p.exactMatch) qs.exact_match = true;
        if (p.limit) qs.limit = p.limit;
        if (p.fields) qs.fields = p.fields;
        // Search uses v1 API
        const res = (await api(
          ctx,
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
        return api(
          ctx,
          "POST",
          `${endpoint}/${pathSegment((input as Record<string, unknown>).id)}/duplicate`,
        );
      },
    });
  }
}

export default function pipedrive(rl: RunlinePluginAPI) {
  rl.setName("pipedrive");
  rl.setVersion("0.1.0");
  rl.setCredential(pipedriveCredential);
  rl.setConnectionSchema({
    apiToken: {
      type: "string",
      required: true,
      description: "Pipedrive API token",
      env: "PIPEDRIVE_API_TOKEN",
    },
  });

  // ── Activity ────────────────────────────────────────
  registerCrud(rl, "activity", "activities");

  // ── Deal ────────────────────────────────────────────
  registerCrud(rl, "deal", "deals", { hasSearch: true, hasDuplicate: true });

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
      const { dealId, ...body } = input as Record<string, unknown>;
      return api(ctx, "POST", `deals/${pathSegment(dealId)}/products`, {
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
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      return api(
        ctx,
        "GET",
        `deals/${pathSegment(p.dealId)}/products`,
        undefined,
        qs,
      );
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
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "PATCH",
        `deals/${pathSegment(p.dealId)}/products/${pathSegment(p.productAttachmentId)}`,
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
      const p = input as Record<string, unknown>;
      await api(
        ctx,
        "DELETE",
        `deals/${pathSegment(p.dealId)}/products/${pathSegment(p.productAttachmentId)}`,
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
        ctx,
        "GET",
        `files/${pathSegment((input as Record<string, unknown>).id)}`,
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
        ctx,
        "DELETE",
        `files/${pathSegment((input as Record<string, unknown>).id)}`,
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
      return api(ctx, "PUT", `files/${pathSegment(id)}`, body, undefined, "v1");
    },
  });

  // ── Lead ────────────────────────────────────────────
  registerCrud(rl, "lead", "leads");

  // ── Note ────────────────────────────────────────────
  registerCrud(rl, "note", "notes");

  // ── Organization ────────────────────────────────────
  registerCrud(rl, "organization", "organizations", { hasSearch: true });

  // ── Person ──────────────────────────────────────────
  registerCrud(rl, "person", "persons", { hasSearch: true });

  // ── Product ─────────────────────────────────────────
  registerCrud(rl, "product", "products", { hasSearch: true });
}
