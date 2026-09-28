import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { codaCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, codaCredential, "coda", {
    target: "api",
    path,
    method,
    query,
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: body }
      : {}),
  });
}

async function paginateAll(
  ctx: ActionContext,
  path: string,
  qs?: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let pageToken: string | undefined;
  while (true) {
    const q = { ...qs } as Record<string, unknown>;
    if (pageToken) q.pageToken = pageToken;
    const data = (await apiRequest(ctx, "GET", path, undefined, q)) as Record<
      string,
      unknown
    >;
    const items = (data.items as unknown[]) ?? [];
    results.push(...items);
    if (limit && results.length >= limit) return results.slice(0, limit);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken as string;
  }
  return results;
}

export default function coda(rl: RunlinePluginAPI) {
  rl.setName("coda");
  rl.setVersion("0.1.0");
  rl.setCredential(codaCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Coda API token",
      env: "CODA_ACCESS_TOKEN",
    },
  });

  // ── Table Row ───────────────────────────────────────

  rl.registerAction("table.createRow", {
    access: "write",
    description: "Create/upsert a row in a table",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      cells: {
        type: "object",
        required: true,
        description: "Column-value pairs",
      },
      keyColumns: {
        type: "array",
        required: false,
        description: "Key columns for upsert",
      },
      disableParsing: {
        type: "boolean",
        required: false,
        description: "Disable value parsing",
      },
    },
    async execute(input, ctx) {
      const { docId, tableId, cells, keyColumns, disableParsing } =
        input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (disableParsing) qs.disableParsing = true;
      const row = Object.entries(cells as Record<string, unknown>).map(
        ([column, value]) => ({ column, value }),
      );
      const body: Record<string, unknown> = { rows: [{ cells: row }] };
      if (keyColumns) body.keyColumns = keyColumns;
      return apiRequest(
        ctx,
        "POST",
        `docs/${seg(docId)}/tables/${seg(tableId)}/rows`,
        body,
        qs,
      );
    },
  });

  rl.registerAction("table.getRow", {
    access: "read",
    description: "Get a row by ID",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      rowId: { type: "string", required: true, description: "Row ID or name" },
      useColumnNames: {
        type: "boolean",
        required: false,
        description: "Use column names (default: true)",
      },
      valueFormat: {
        type: "string",
        required: false,
        description: "Value format: simple, simpleWithArrays, rich",
      },
    },
    async execute(input, ctx) {
      const {
        docId,
        tableId,
        rowId,
        useColumnNames = true,
        valueFormat,
      } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { useColumnNames };
      if (valueFormat) qs.valueFormat = valueFormat;
      const data = (await apiRequest(
        ctx,
        "GET",
        `docs/${seg(docId)}/tables/${seg(tableId)}/rows/${seg(rowId)}`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return { id: data.id, ...(data.values as Record<string, unknown>) };
    },
  });

  rl.registerAction("table.listRows", {
    access: "read",
    description: "List rows in a table",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      query: { type: "string", required: false, description: "Search query" },
      sortBy: { type: "string", required: false, description: "Sort column" },
      useColumnNames: {
        type: "boolean",
        required: false,
        description: "Use column names (default: true)",
      },
      valueFormat: {
        type: "string",
        required: false,
        description: "Value format",
      },
      visibleOnly: {
        type: "boolean",
        required: false,
        description: "Only visible rows",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const {
        docId,
        tableId,
        query,
        sortBy,
        useColumnNames = true,
        valueFormat,
        visibleOnly,
        limit,
      } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { useColumnNames };
      if (query) qs.query = query;
      if (sortBy) qs.sortBy = sortBy;
      if (valueFormat) qs.valueFormat = valueFormat;
      if (visibleOnly) qs.visibleOnly = visibleOnly;
      const rows = await paginateAll(
        ctx,
        `docs/${seg(docId)}/tables/${seg(tableId)}/rows`,
        qs,
        limit as number | undefined,
      );
      return rows.map((r) => {
        const row = r as Record<string, unknown>;
        return { id: row.id, ...(row.values as Record<string, unknown>) };
      });
    },
  });

  rl.registerAction("table.deleteRow", {
    access: "write",
    description: "Delete a row",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      rowId: { type: "string", required: true, description: "Row ID" },
    },
    async execute(input, ctx) {
      const { docId, tableId, rowId } = input as Record<string, string>;
      return apiRequest(
        ctx,
        "DELETE",
        `docs/${seg(docId)}/tables/${seg(tableId)}/rows`,
        { rowIds: [rowId] },
      );
    },
  });

  rl.registerAction("table.pushButton", {
    access: "write",
    description: "Push a button on a row",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      rowId: { type: "string", required: true, description: "Row ID" },
      columnId: {
        type: "string",
        required: true,
        description: "Button column ID",
      },
    },
    async execute(input, ctx) {
      const { docId, tableId, rowId, columnId } = input as Record<
        string,
        string
      >;
      return apiRequest(
        ctx,
        "POST",
        `docs/${seg(docId)}/tables/${seg(tableId)}/rows/${seg(rowId)}/buttons/${seg(columnId)}`,
      );
    },
  });

  // ── Table Column ────────────────────────────────────

  rl.registerAction("table.getColumn", {
    access: "read",
    description: "Get a column",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      columnId: { type: "string", required: true, description: "Column ID" },
    },
    async execute(input, ctx) {
      const { docId, tableId, columnId } = input as Record<string, string>;
      return apiRequest(
        ctx,
        "GET",
        `docs/${seg(docId)}/tables/${seg(tableId)}/columns/${seg(columnId)}`,
      );
    },
  });

  rl.registerAction("table.listColumns", {
    access: "read",
    description: "List columns in a table",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { docId, tableId, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      return paginateAll(
        ctx,
        `docs/${seg(docId)}/tables/${seg(tableId)}/columns`,
        undefined,
        limit as number | undefined,
      );
    },
  });

  // ── Formula ─────────────────────────────────────────

  rl.registerAction("formula.get", {
    access: "read",
    description: "Get a formula",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      formulaId: { type: "string", required: true, description: "Formula ID" },
    },
    async execute(input, ctx) {
      const { docId, formulaId } = input as Record<string, string>;
      return apiRequest(
        ctx,
        "GET",
        `docs/${seg(docId)}/formulas/${seg(formulaId)}`,
      );
    },
  });

  rl.registerAction("formula.list", {
    access: "read",
    description: "List formulas in a doc",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { docId, limit } = (input ?? {}) as Record<string, unknown>;
      return paginateAll(
        ctx,
        `docs/${seg(docId)}/formulas`,
        undefined,
        limit as number | undefined,
      );
    },
  });

  // ── Control ─────────────────────────────────────────

  rl.registerAction("control.get", {
    access: "read",
    description: "Get a control",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      controlId: { type: "string", required: true, description: "Control ID" },
    },
    async execute(input, ctx) {
      const { docId, controlId } = input as Record<string, string>;
      return apiRequest(
        ctx,
        "GET",
        `docs/${seg(docId)}/controls/${seg(controlId)}`,
      );
    },
  });

  rl.registerAction("control.list", {
    access: "read",
    description: "List controls in a doc",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { docId, limit } = (input ?? {}) as Record<string, unknown>;
      return paginateAll(
        ctx,
        `docs/${seg(docId)}/controls`,
        undefined,
        limit as number | undefined,
      );
    },
  });

  // ── View ────────────────────────────────────────────

  rl.registerAction("view.get", {
    access: "read",
    description: "Get a view",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      viewId: { type: "string", required: true, description: "View ID" },
    },
    async execute(input, ctx) {
      const { docId, viewId } = input as Record<string, string>;
      return apiRequest(ctx, "GET", `docs/${seg(docId)}/tables/${seg(viewId)}`);
    },
  });

  rl.registerAction("view.list", {
    access: "read",
    description: "List views in a doc",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { docId, limit } = (input ?? {}) as Record<string, unknown>;
      return paginateAll(
        ctx,
        `docs/${seg(docId)}/tables`,
        { tableTypes: "view" },
        limit as number | undefined,
      );
    },
  });

  rl.registerAction("view.listRows", {
    access: "read",
    description: "List rows in a view",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      viewId: { type: "string", required: true, description: "View ID" },
      query: { type: "string", required: false, description: "Search query" },
      sortBy: { type: "string", required: false, description: "Sort column" },
      useColumnNames: {
        type: "boolean",
        required: false,
        description: "Use column names (default: true)",
      },
      valueFormat: {
        type: "string",
        required: false,
        description: "Value format",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const {
        docId,
        viewId,
        query,
        sortBy,
        useColumnNames = true,
        valueFormat,
        limit,
      } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { useColumnNames };
      if (query) qs.query = query;
      if (sortBy) qs.sortBy = sortBy;
      if (valueFormat) qs.valueFormat = valueFormat;
      const rows = await paginateAll(
        ctx,
        `docs/${seg(docId)}/tables/${seg(viewId)}/rows`,
        qs,
        limit as number | undefined,
      );
      return rows.map((r) => {
        const row = r as Record<string, unknown>;
        return { id: row.id, ...(row.values as Record<string, unknown>) };
      });
    },
  });

  rl.registerAction("view.deleteRow", {
    access: "write",
    description: "Delete a row from a view",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      viewId: { type: "string", required: true, description: "View ID" },
      rowId: { type: "string", required: true, description: "Row ID" },
    },
    async execute(input, ctx) {
      const { docId, viewId, rowId } = input as Record<string, string>;
      return apiRequest(
        ctx,
        "DELETE",
        `docs/${seg(docId)}/tables/${seg(viewId)}/rows/${seg(rowId)}`,
      );
    },
  });

  rl.registerAction("view.updateRow", {
    access: "write",
    description: "Update a row in a view",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      viewId: { type: "string", required: true, description: "View ID" },
      rowId: { type: "string", required: true, description: "Row ID" },
      cells: {
        type: "object",
        required: true,
        description: "Column-value pairs to update",
      },
      disableParsing: {
        type: "boolean",
        required: false,
        description: "Disable value parsing",
      },
    },
    async execute(input, ctx) {
      const { docId, viewId, rowId, cells, disableParsing } = input as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (disableParsing) qs.disableParsing = true;
      const row = Object.entries(cells as Record<string, unknown>).map(
        ([column, value]) => ({ column, value }),
      );
      return apiRequest(
        ctx,
        "PUT",
        `docs/${seg(docId)}/tables/${seg(viewId)}/rows/${seg(rowId)}`,
        { row: { cells: row } },
        qs,
      );
    },
  });

  rl.registerAction("view.pushButton", {
    access: "write",
    description: "Push a button on a view row",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      viewId: { type: "string", required: true, description: "View ID" },
      rowId: { type: "string", required: true, description: "Row ID" },
      columnId: {
        type: "string",
        required: true,
        description: "Button column ID",
      },
    },
    async execute(input, ctx) {
      const { docId, viewId, rowId, columnId } = input as Record<
        string,
        string
      >;
      return apiRequest(
        ctx,
        "POST",
        `docs/${seg(docId)}/tables/${seg(viewId)}/rows/${seg(rowId)}/buttons/${seg(columnId)}`,
      );
    },
  });

  rl.registerAction("view.listColumns", {
    access: "read",
    description: "List columns in a view",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      viewId: { type: "string", required: true, description: "View ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { docId, viewId, limit } = (input ?? {}) as Record<string, unknown>;
      return paginateAll(
        ctx,
        `docs/${seg(docId)}/tables/${seg(viewId)}/columns`,
        undefined,
        limit as number | undefined,
      );
    },
  });
}
