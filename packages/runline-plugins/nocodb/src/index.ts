import type { RunlinePluginAPI } from "runline";

interface Conn {
  config: Record<string, unknown>;
}

function getConn(ctx: { connection: Conn }) {
  const c = ctx.connection.config;
  const host = (c.host as string).replace(/\/$/, "");
  return { host, token: c.apiToken as string };
}

async function apiRequest(
  conn: { host: string; token: string },
  method: string,
  endpoint: string,
  body?: unknown,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${conn.host}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      "xc-token": conn.token,
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok)
    throw new Error(`NocoDB API error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function paginate(
  conn: { host: string; token: string },
  endpoint: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  qs.limit = 100;
  qs.offset = 0;
  let isLast = false;
  while (!isLast) {
    const data = (await apiRequest(
      conn,
      "GET",
      endpoint,
      undefined,
      qs,
    )) as Record<string, unknown>;
    const list = (data.list ?? []) as unknown[];
    all.push(...list);
    const pageInfo = data.pageInfo as Record<string, unknown> | undefined;
    isLast = pageInfo?.isLastPage === true || list.length === 0;
    qs.offset = (qs.offset as number) + (qs.limit as number);
  }
  return all;
}

export default function nocodb(rl: RunlinePluginAPI) {
  rl.setName("nocodb");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    host: {
      type: "string",
      required: true,
      description: "NocoDB host URL (e.g. https://nocodb.example.com)",
      env: "NOCODB_HOST",
    },
    apiToken: {
      type: "string",
      required: true,
      description: "NocoDB API token (xc-token)",
      env: "NOCODB_API_TOKEN",
    },
  });

  rl.registerAction("row.create", {
    access: "write",
    description: "Create one or more rows in a NocoDB table (v2 API)",
    inputSchema: {
      tableId: { type: "string", required: true, description: "Table ID" },
      rows: {
        type: "object",
        required: true,
        description: "Array of row objects to create",
      },
    },
    async execute(input, ctx) {
      const { tableId, rows } = input as Record<string, unknown>;
      const conn = getConn(ctx);
      return apiRequest(
        conn,
        "POST",
        `/api/v2/tables/${tableId}/records`,
        rows,
      );
    },
  });

  rl.registerAction("row.get", {
    access: "read",
    description: "Get a single row by ID",
    inputSchema: {
      tableId: { type: "string", required: true, description: "Table ID" },
      rowId: { type: "string", required: true, description: "Row ID" },
    },
    async execute(input, ctx) {
      const { tableId, rowId } = input as Record<string, unknown>;
      return apiRequest(
        getConn(ctx),
        "GET",
        `/api/v2/tables/${tableId}/records/${rowId}`,
      );
    },
  });

  rl.registerAction("row.list", {
    access: "read",
    description: "List rows from a NocoDB table",
    inputSchema: {
      tableId: { type: "string", required: true, description: "Table ID" },
      limit: {
        type: "number",
        required: false,
        description: "Max rows to return (default: all)",
      },
      where: {
        type: "string",
        required: false,
        description: "Filter formula, e.g. (name,like,example%)",
      },
      sort: {
        type: "string",
        required: false,
        description: "Sort string, e.g. -fieldName for desc",
      },
      fields: {
        type: "string",
        required: false,
        description: "Comma-separated field names to return",
      },
      viewId: {
        type: "string",
        required: false,
        description: "View ID to filter by",
      },
      offset: {
        type: "number",
        required: false,
        description: "Offset for pagination",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const conn = getConn(ctx);
      const endpoint = `/api/v2/tables/${p.tableId}/records`;
      const qs: Record<string, unknown> = {};
      if (p.where) qs.where = p.where;
      if (p.sort) qs.sort = p.sort;
      if (p.fields) qs.fields = p.fields;
      if (p.viewId) qs.viewId = p.viewId;
      if (p.offset) qs.offset = p.offset;

      if (p.limit) {
        qs.limit = p.limit;
        const data = (await apiRequest(
          conn,
          "GET",
          endpoint,
          undefined,
          qs,
        )) as Record<string, unknown>;
        return data.list;
      }
      return paginate(conn, endpoint, qs);
    },
  });

  rl.registerAction("row.update", {
    access: "write",
    description:
      "Update one or more rows (include primary key in each row object)",
    inputSchema: {
      tableId: { type: "string", required: true, description: "Table ID" },
      rows: {
        type: "object",
        required: true,
        description: "Array of row objects with primary key included",
      },
    },
    async execute(input, ctx) {
      const { tableId, rows } = input as Record<string, unknown>;
      return apiRequest(
        getConn(ctx),
        "PATCH",
        `/api/v2/tables/${tableId}/records`,
        rows,
      );
    },
  });

  rl.registerAction("row.delete", {
    access: "write",
    description: "Delete one or more rows by ID",
    inputSchema: {
      tableId: { type: "string", required: true, description: "Table ID" },
      ids: {
        type: "object",
        required: true,
        description:
          "Array of objects with primary key, e.g. [{Id: 1}, {Id: 2}]",
      },
    },
    async execute(input, ctx) {
      const { tableId, ids } = input as Record<string, unknown>;
      return apiRequest(
        getConn(ctx),
        "DELETE",
        `/api/v2/tables/${tableId}/records`,
        ids,
      );
    },
  });
}
