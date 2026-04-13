import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://coda.io/apis/v1";

async function apiRequest(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Coda API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

async function paginateAll(
  token: string,
  endpoint: string,
  qs?: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let pageToken: string | undefined;
  while (true) {
    const q = { ...qs } as Record<string, unknown>;
    if (pageToken) q.pageToken = pageToken;
    const data = (await apiRequest(token, "GET", endpoint, undefined, q)) as Record<string, unknown>;
    const items = (data.items as unknown[]) ?? [];
    results.push(...items);
    if (limit && results.length >= limit) return results.slice(0, limit);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken as string;
  }
  return results;
}

function getToken(ctx: { connection: { config: Record<string, unknown> } }): string {
  return ctx.connection.config.accessToken as string;
}

export default function coda(rl: RunlinePluginAPI) {
  rl.setName("coda");
  rl.setVersion("0.1.0");

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
    description: "Create/upsert a row in a table",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      cells: { type: "object", required: true, description: "Column-value pairs" },
      keyColumns: { type: "array", required: false, description: "Key columns for upsert" },
      disableParsing: { type: "boolean", required: false, description: "Disable value parsing" },
    },
    async execute(input, ctx) {
      const { docId, tableId, cells, keyColumns, disableParsing } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (disableParsing) qs.disableParsing = true;
      const row = Object.entries(cells as Record<string, unknown>).map(([column, value]) => ({ column, value }));
      const body: Record<string, unknown> = { rows: [{ cells: row }] };
      if (keyColumns) body.keyColumns = keyColumns;
      return apiRequest(getToken(ctx), "POST", `/docs/${docId}/tables/${tableId}/rows`, body, qs);
    },
  });

  rl.registerAction("table.getRow", {
    description: "Get a row by ID",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      rowId: { type: "string", required: true, description: "Row ID or name" },
      useColumnNames: { type: "boolean", required: false, description: "Use column names (default: true)" },
      valueFormat: { type: "string", required: false, description: "Value format: simple, simpleWithArrays, rich" },
    },
    async execute(input, ctx) {
      const { docId, tableId, rowId, useColumnNames = true, valueFormat } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { useColumnNames };
      if (valueFormat) qs.valueFormat = valueFormat;
      const data = (await apiRequest(getToken(ctx), "GET", `/docs/${docId}/tables/${tableId}/rows/${rowId}`, undefined, qs)) as Record<string, unknown>;
      return { id: data.id, ...(data.values as Record<string, unknown>) };
    },
  });

  rl.registerAction("table.listRows", {
    description: "List rows in a table",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      query: { type: "string", required: false, description: "Search query" },
      sortBy: { type: "string", required: false, description: "Sort column" },
      useColumnNames: { type: "boolean", required: false, description: "Use column names (default: true)" },
      valueFormat: { type: "string", required: false, description: "Value format" },
      visibleOnly: { type: "boolean", required: false, description: "Only visible rows" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { docId, tableId, query, sortBy, useColumnNames = true, valueFormat, visibleOnly, limit } =
        (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { useColumnNames };
      if (query) qs.query = query;
      if (sortBy) qs.sortBy = sortBy;
      if (valueFormat) qs.valueFormat = valueFormat;
      if (visibleOnly) qs.visibleOnly = visibleOnly;
      const rows = await paginateAll(getToken(ctx), `/docs/${docId}/tables/${tableId}/rows`, qs, limit as number | undefined);
      return rows.map((r) => {
        const row = r as Record<string, unknown>;
        return { id: row.id, ...(row.values as Record<string, unknown>) };
      });
    },
  });

  rl.registerAction("table.deleteRow", {
    description: "Delete a row",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      rowId: { type: "string", required: true, description: "Row ID" },
    },
    async execute(input, ctx) {
      const { docId, tableId, rowId } = input as Record<string, string>;
      return apiRequest(getToken(ctx), "DELETE", `/docs/${docId}/tables/${tableId}/rows`, { rowIds: [rowId] });
    },
  });

  rl.registerAction("table.pushButton", {
    description: "Push a button on a row",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      rowId: { type: "string", required: true, description: "Row ID" },
      columnId: { type: "string", required: true, description: "Button column ID" },
    },
    async execute(input, ctx) {
      const { docId, tableId, rowId, columnId } = input as Record<string, string>;
      return apiRequest(getToken(ctx), "POST", `/docs/${docId}/tables/${tableId}/rows/${rowId}/buttons/${columnId}`);
    },
  });

  // ── Table Column ────────────────────────────────────

  rl.registerAction("table.getColumn", {
    description: "Get a column",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      columnId: { type: "string", required: true, description: "Column ID" },
    },
    async execute(input, ctx) {
      const { docId, tableId, columnId } = input as Record<string, string>;
      return apiRequest(getToken(ctx), "GET", `/docs/${docId}/tables/${tableId}/columns/${columnId}`);
    },
  });

  rl.registerAction("table.listColumns", {
    description: "List columns in a table",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { docId, tableId, limit } = (input ?? {}) as Record<string, unknown>;
      return paginateAll(getToken(ctx), `/docs/${docId}/tables/${tableId}/columns`, undefined, limit as number | undefined);
    },
  });

  // ── Formula ─────────────────────────────────────────

  rl.registerAction("formula.get", {
    description: "Get a formula",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      formulaId: { type: "string", required: true, description: "Formula ID" },
    },
    async execute(input, ctx) {
      const { docId, formulaId } = input as Record<string, string>;
      return apiRequest(getToken(ctx), "GET", `/docs/${docId}/formulas/${formulaId}`);
    },
  });

  rl.registerAction("formula.list", {
    description: "List formulas in a doc",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { docId, limit } = (input ?? {}) as Record<string, unknown>;
      return paginateAll(getToken(ctx), `/docs/${docId}/formulas`, undefined, limit as number | undefined);
    },
  });

  // ── Control ─────────────────────────────────────────

  rl.registerAction("control.get", {
    description: "Get a control",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      controlId: { type: "string", required: true, description: "Control ID" },
    },
    async execute(input, ctx) {
      const { docId, controlId } = input as Record<string, string>;
      return apiRequest(getToken(ctx), "GET", `/docs/${docId}/controls/${controlId}`);
    },
  });

  rl.registerAction("control.list", {
    description: "List controls in a doc",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { docId, limit } = (input ?? {}) as Record<string, unknown>;
      return paginateAll(getToken(ctx), `/docs/${docId}/controls`, undefined, limit as number | undefined);
    },
  });

  // ── View ────────────────────────────────────────────

  rl.registerAction("view.get", {
    description: "Get a view",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      viewId: { type: "string", required: true, description: "View ID" },
    },
    async execute(input, ctx) {
      const { docId, viewId } = input as Record<string, string>;
      return apiRequest(getToken(ctx), "GET", `/docs/${docId}/tables/${viewId}`);
    },
  });

  rl.registerAction("view.list", {
    description: "List views in a doc",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { docId, limit } = (input ?? {}) as Record<string, unknown>;
      return paginateAll(getToken(ctx), `/docs/${docId}/tables`, { tableTypes: "view" }, limit as number | undefined);
    },
  });

  rl.registerAction("view.listRows", {
    description: "List rows in a view",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      viewId: { type: "string", required: true, description: "View ID" },
      query: { type: "string", required: false, description: "Search query" },
      sortBy: { type: "string", required: false, description: "Sort column" },
      useColumnNames: { type: "boolean", required: false, description: "Use column names (default: true)" },
      valueFormat: { type: "string", required: false, description: "Value format" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { docId, viewId, query, sortBy, useColumnNames = true, valueFormat, limit } =
        (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { useColumnNames };
      if (query) qs.query = query;
      if (sortBy) qs.sortBy = sortBy;
      if (valueFormat) qs.valueFormat = valueFormat;
      const rows = await paginateAll(getToken(ctx), `/docs/${docId}/tables/${viewId}/rows`, qs, limit as number | undefined);
      return rows.map((r) => {
        const row = r as Record<string, unknown>;
        return { id: row.id, ...(row.values as Record<string, unknown>) };
      });
    },
  });

  rl.registerAction("view.deleteRow", {
    description: "Delete a row from a view",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      viewId: { type: "string", required: true, description: "View ID" },
      rowId: { type: "string", required: true, description: "Row ID" },
    },
    async execute(input, ctx) {
      const { docId, viewId, rowId } = input as Record<string, string>;
      return apiRequest(getToken(ctx), "DELETE", `/docs/${docId}/tables/${viewId}/rows/${rowId}`);
    },
  });

  rl.registerAction("view.updateRow", {
    description: "Update a row in a view",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      viewId: { type: "string", required: true, description: "View ID" },
      rowId: { type: "string", required: true, description: "Row ID" },
      cells: { type: "object", required: true, description: "Column-value pairs to update" },
      disableParsing: { type: "boolean", required: false, description: "Disable value parsing" },
    },
    async execute(input, ctx) {
      const { docId, viewId, rowId, cells, disableParsing } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (disableParsing) qs.disableParsing = true;
      const row = Object.entries(cells as Record<string, unknown>).map(([column, value]) => ({ column, value }));
      return apiRequest(getToken(ctx), "PUT", `/docs/${docId}/tables/${viewId}/rows/${rowId}`, { row: { cells: row } }, qs);
    },
  });

  rl.registerAction("view.pushButton", {
    description: "Push a button on a view row",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      viewId: { type: "string", required: true, description: "View ID" },
      rowId: { type: "string", required: true, description: "Row ID" },
      columnId: { type: "string", required: true, description: "Button column ID" },
    },
    async execute(input, ctx) {
      const { docId, viewId, rowId, columnId } = input as Record<string, string>;
      return apiRequest(getToken(ctx), "POST", `/docs/${docId}/tables/${viewId}/rows/${rowId}/buttons/${columnId}`);
    },
  });

  rl.registerAction("view.listColumns", {
    description: "List columns in a view",
    inputSchema: {
      docId: { type: "string", required: true, description: "Doc ID" },
      viewId: { type: "string", required: true, description: "View ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { docId, viewId, limit } = (input ?? {}) as Record<string, unknown>;
      return paginateAll(getToken(ctx), `/docs/${docId}/tables/${viewId}/columns`, undefined, limit as number | undefined);
    },
  });
}
