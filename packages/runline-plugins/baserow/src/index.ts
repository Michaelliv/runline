import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { baserowCredential } from "./credentials.js";

/** A path beneath the host's /api/ base, signed through the credential. */
function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: unknown,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, baserowCredential, "baserow", {
    target: "api",
    path,
    method,
    query,
    ...(body && method !== "GET" && method !== "DELETE" ? { json: body } : {}),
  });
}

async function paginateAll(
  ctx: ActionContext,
  path: string,
  qs?: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let page = 1;
  const size = 100;

  while (true) {
    const data = (await apiRequest(ctx, "GET", path, undefined, {
      ...qs,
      page,
      size,
    })) as { results: unknown[]; next?: string };

    results.push(...(data.results ?? []));
    if (limit && results.length >= limit) return results.slice(0, limit);
    if (!data.next) break;
    page++;
  }

  return results;
}

export default function baserow(rl: RunlinePluginAPI) {
  rl.setName("baserow");
  rl.setVersion("0.1.0");
  rl.setCredential(baserowCredential);

  rl.setConnectionSchema({
    host: {
      type: "string",
      required: true,
      description: "Baserow host URL (e.g. https://api.baserow.io)",
      env: "BASEROW_HOST",
      default: "https://api.baserow.io",
    },
    token: {
      type: "string",
      required: true,
      description: "Baserow database token",
      env: "BASEROW_TOKEN",
    },
  });

  // ── Row ─────────────────────────────────────────────

  rl.registerAction("row.create", {
    access: "write",
    description: "Create a row in a table",
    inputSchema: {
      tableId: { type: "string", required: true, description: "Table ID" },
      fields: {
        type: "object",
        required: true,
        description:
          "Field values as key-value pairs (use field_N keys or field names)",
      },
    },
    async execute(input, ctx) {
      const { tableId, fields } = input as {
        tableId: string;
        fields: Record<string, unknown>;
      };
      return apiRequest(
        ctx,
        "POST",
        `database/rows/table/${pathSegment(tableId)}/`,
        fields,
      );
    },
  });

  rl.registerAction("row.get", {
    access: "read",
    description: "Get a row by ID",
    inputSchema: {
      tableId: { type: "string", required: true, description: "Table ID" },
      rowId: { type: "string", required: true, description: "Row ID" },
    },
    async execute(input, ctx) {
      const { tableId, rowId } = input as { tableId: string; rowId: string };
      return apiRequest(
        ctx,
        "GET",
        `database/rows/table/${pathSegment(tableId)}/${pathSegment(rowId)}/`,
      );
    },
  });

  rl.registerAction("row.list", {
    access: "read",
    description: "List rows from a table with optional filtering and sorting",
    inputSchema: {
      tableId: { type: "string", required: true, description: "Table ID" },
      search: { type: "string", required: false, description: "Search query" },
      orderBy: {
        type: "string",
        required: false,
        description:
          "Comma-separated field IDs prefixed with +/- (e.g. +field_1,-field_2)",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { tableId, search, orderBy, limit } = input as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (search) qs.search = search;
      if (orderBy) qs.order_by = orderBy;
      return paginateAll(
        ctx,
        `database/rows/table/${pathSegment(tableId)}/`,
        qs,
        limit as number | undefined,
      );
    },
  });

  rl.registerAction("row.update", {
    access: "write",
    description: "Update a row (PATCH — only updates specified fields)",
    inputSchema: {
      tableId: { type: "string", required: true, description: "Table ID" },
      rowId: { type: "string", required: true, description: "Row ID" },
      fields: {
        type: "object",
        required: true,
        description: "Fields to update",
      },
    },
    async execute(input, ctx) {
      const { tableId, rowId, fields } = input as {
        tableId: string;
        rowId: string;
        fields: Record<string, unknown>;
      };
      return apiRequest(
        ctx,
        "PATCH",
        `database/rows/table/${pathSegment(tableId)}/${pathSegment(rowId)}/`,
        fields,
      );
    },
  });

  rl.registerAction("row.delete", {
    access: "write",
    description: "Delete a row",
    inputSchema: {
      tableId: { type: "string", required: true, description: "Table ID" },
      rowId: { type: "string", required: true, description: "Row ID" },
    },
    async execute(input, ctx) {
      const { tableId, rowId } = input as { tableId: string; rowId: string };
      await apiRequest(
        ctx,
        "DELETE",
        `database/rows/table/${pathSegment(tableId)}/${pathSegment(rowId)}/`,
      );
      return { success: true };
    },
  });

  rl.registerAction("row.batchCreate", {
    access: "write",
    description: "Create up to 200 rows in one request",
    inputSchema: {
      tableId: { type: "string", required: true, description: "Table ID" },
      items: {
        type: "array",
        required: true,
        description: "Array of row objects with field values",
      },
    },
    async execute(input, ctx) {
      const { tableId, items } = input as { tableId: string; items: unknown[] };
      return apiRequest(
        ctx,
        "POST",
        `database/rows/table/${pathSegment(tableId)}/batch/`,
        {
          items,
        },
      );
    },
  });

  rl.registerAction("row.batchUpdate", {
    access: "write",
    description: "Update up to 200 rows in one request",
    inputSchema: {
      tableId: { type: "string", required: true, description: "Table ID" },
      items: {
        type: "array",
        required: true,
        description: "Array of { id, ...fields } objects",
      },
    },
    async execute(input, ctx) {
      const { tableId, items } = input as { tableId: string; items: unknown[] };
      return apiRequest(
        ctx,
        "PATCH",
        `database/rows/table/${pathSegment(tableId)}/batch/`,
        { items },
      );
    },
  });

  rl.registerAction("row.batchDelete", {
    access: "write",
    description: "Delete up to 200 rows in one request",
    inputSchema: {
      tableId: { type: "string", required: true, description: "Table ID" },
      rowIds: {
        type: "array",
        required: true,
        description: "Array of row IDs to delete",
      },
    },
    async execute(input, ctx) {
      const { tableId, rowIds } = input as {
        tableId: string;
        rowIds: string[];
      };
      await apiRequest(
        ctx,
        "POST",
        `database/rows/table/${pathSegment(tableId)}/batch-delete/`,
        {
          items: rowIds,
        },
      );
      return { success: true, deleted: rowIds };
    },
  });
}
