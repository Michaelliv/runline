import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.airtable.com/v0";

async function apiRequest(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(`${k}[]`, String(item));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  ) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return { success: true };
  return res.json();
}

async function paginateRecords(
  token: string,
  endpoint: string,
  qs?: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  const _qs = { pageSize: 100, ...qs };
  let offset: string | undefined;

  while (true) {
    if (offset) (_qs as Record<string, unknown>).offset = offset;
    const data = (await apiRequest(token, "GET", endpoint, undefined, _qs)) as {
      records: unknown[];
      offset?: string;
    };

    results.push(...data.records);

    if (limit && results.length >= limit) return results.slice(0, limit);
    if (!data.offset) break;
    offset = data.offset;
  }

  return results;
}

/** Airtable limits batch writes to 10 records at a time */
async function batchWrite(
  token: string,
  method: "POST" | "PATCH",
  endpoint: string,
  records: Array<Record<string, unknown>>,
  extraBody?: Record<string, unknown>,
): Promise<unknown[]> {
  const results: unknown[] = [];
  const batchSize = 10;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const body = { ...extraBody, records: batch };
    const data = (await apiRequest(token, method, endpoint, body)) as {
      records: unknown[];
    };
    results.push(...data.records);
  }

  return results;
}

function getToken(ctx: {
  connection: { config: Record<string, unknown> };
}): string {
  return ctx.connection.config.token as string;
}

export default function airtable(rl: RunlinePluginAPI) {
  rl.setName("airtable");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    token: {
      type: "string",
      required: true,
      description: "Airtable personal access token or API key",
      env: "AIRTABLE_TOKEN",
    },
  });

  // ── Base ────────────────────────────────────────────

  rl.registerAction("base.list", {
    access: "read",
    description: "List all accessible bases",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const token = getToken(ctx);
      const results: unknown[] = [];
      let offset: string | undefined;

      while (true) {
        const qs: Record<string, unknown> = {};
        if (offset) qs.offset = offset;
        const data = (await apiRequest(
          token,
          "GET",
          "meta/bases",
          undefined,
          qs,
        )) as {
          bases: unknown[];
          offset?: string;
        };
        results.push(...data.bases);
        if (limit && results.length >= limit) return results.slice(0, limit);
        if (!data.offset) break;
        offset = data.offset;
      }

      return results;
    },
  });

  rl.registerAction("base.getSchema", {
    access: "read",
    description: "Get the schema (tables and fields) of a base",
    inputSchema: {
      baseId: {
        type: "string",
        required: true,
        description: "Base ID (e.g. appXXXXXXXXXXXXXX)",
      },
    },
    async execute(input, ctx) {
      const { baseId } = input as { baseId: string };
      return apiRequest(getToken(ctx), "GET", `meta/bases/${baseId}/tables`);
    },
  });

  // ── Record ──────────────────────────────────────────

  rl.registerAction("record.create", {
    access: "write",
    description: "Create a record in a table",
    inputSchema: {
      baseId: { type: "string", required: true, description: "Base ID" },
      tableId: {
        type: "string",
        required: true,
        description: "Table ID or name",
      },
      fields: {
        type: "object",
        required: true,
        description: "Field values as key-value pairs",
      },
      typecast: {
        type: "boolean",
        required: false,
        description: "Automatically convert field values to appropriate types",
      },
    },
    async execute(input, ctx) {
      const { baseId, tableId, fields, typecast } = input as {
        baseId: string;
        tableId: string;
        fields: Record<string, unknown>;
        typecast?: boolean;
      };
      const body: Record<string, unknown> = { fields };
      if (typecast) body.typecast = true;
      return apiRequest(getToken(ctx), "POST", `${baseId}/${tableId}`, body);
    },
  });

  rl.registerAction("record.createMany", {
    access: "write",
    description: "Create multiple records in a table (batched in groups of 10)",
    inputSchema: {
      baseId: { type: "string", required: true, description: "Base ID" },
      tableId: {
        type: "string",
        required: true,
        description: "Table ID or name",
      },
      records: {
        type: "array",
        required: true,
        description: "Array of { fields: { ... } } objects",
      },
      typecast: {
        type: "boolean",
        required: false,
        description: "Auto-typecast values",
      },
    },
    async execute(input, ctx) {
      const { baseId, tableId, records, typecast } = input as {
        baseId: string;
        tableId: string;
        records: Array<Record<string, unknown>>;
        typecast?: boolean;
      };
      const extra: Record<string, unknown> = {};
      if (typecast) extra.typecast = true;
      return batchWrite(
        getToken(ctx),
        "POST",
        `${baseId}/${tableId}`,
        records,
        extra,
      );
    },
  });

  rl.registerAction("record.get", {
    access: "read",
    description: "Get a single record by ID",
    inputSchema: {
      baseId: { type: "string", required: true, description: "Base ID" },
      tableId: {
        type: "string",
        required: true,
        description: "Table ID or name",
      },
      recordId: {
        type: "string",
        required: true,
        description: "Record ID (e.g. recXXX)",
      },
    },
    async execute(input, ctx) {
      const { baseId, tableId, recordId } = input as {
        baseId: string;
        tableId: string;
        recordId: string;
      };
      return apiRequest(
        getToken(ctx),
        "GET",
        `${baseId}/${tableId}/${recordId}`,
      );
    },
  });

  rl.registerAction("record.search", {
    access: "read",
    description: "Search/list records with optional formula filter and sorting",
    inputSchema: {
      baseId: { type: "string", required: true, description: "Base ID" },
      tableId: {
        type: "string",
        required: true,
        description: "Table ID or name",
      },
      filterByFormula: {
        type: "string",
        required: false,
        description: "Airtable formula to filter records",
      },
      fields: {
        type: "array",
        required: false,
        description: "Array of field names to include in response",
      },
      sort: {
        type: "array",
        required: false,
        description:
          "Array of { field, direction } objects (direction: 'asc' or 'desc')",
      },
      view: { type: "string", required: false, description: "View ID or name" },
      limit: {
        type: "number",
        required: false,
        description: "Max records to return",
      },
    },
    async execute(input, ctx) {
      const { baseId, tableId, filterByFormula, fields, sort, view, limit } =
        input as {
          baseId: string;
          tableId: string;
          filterByFormula?: string;
          fields?: string[];
          sort?: Array<{ field: string; direction: string }>;
          view?: string;
          limit?: number;
        };
      const qs: Record<string, unknown> = {};
      if (filterByFormula) qs.filterByFormula = filterByFormula;
      if (fields) qs.fields = fields;
      if (sort) qs.sort = sort;
      if (view) qs.view = view;
      if (limit && !filterByFormula) qs.maxRecords = limit;

      return paginateRecords(getToken(ctx), `${baseId}/${tableId}`, qs, limit);
    },
  });

  rl.registerAction("record.update", {
    access: "write",
    description:
      "Update a record by ID (PATCH — only updates specified fields)",
    inputSchema: {
      baseId: { type: "string", required: true, description: "Base ID" },
      tableId: {
        type: "string",
        required: true,
        description: "Table ID or name",
      },
      recordId: { type: "string", required: true, description: "Record ID" },
      fields: {
        type: "object",
        required: true,
        description: "Fields to update",
      },
      typecast: {
        type: "boolean",
        required: false,
        description: "Auto-typecast values",
      },
    },
    async execute(input, ctx) {
      const { baseId, tableId, recordId, fields, typecast } = input as {
        baseId: string;
        tableId: string;
        recordId: string;
        fields: Record<string, unknown>;
        typecast?: boolean;
      };
      const body: Record<string, unknown> = { fields };
      if (typecast) body.typecast = true;
      return apiRequest(
        getToken(ctx),
        "PATCH",
        `${baseId}/${tableId}/${recordId}`,
        body,
      );
    },
  });

  rl.registerAction("record.updateMany", {
    access: "write",
    description: "Update multiple records (batched in groups of 10)",
    inputSchema: {
      baseId: { type: "string", required: true, description: "Base ID" },
      tableId: {
        type: "string",
        required: true,
        description: "Table ID or name",
      },
      records: {
        type: "array",
        required: true,
        description: "Array of { id, fields: { ... } } objects",
      },
      typecast: {
        type: "boolean",
        required: false,
        description: "Auto-typecast values",
      },
    },
    async execute(input, ctx) {
      const { baseId, tableId, records, typecast } = input as {
        baseId: string;
        tableId: string;
        records: Array<Record<string, unknown>>;
        typecast?: boolean;
      };
      const extra: Record<string, unknown> = {};
      if (typecast) extra.typecast = true;
      return batchWrite(
        getToken(ctx),
        "PATCH",
        `${baseId}/${tableId}`,
        records,
        extra,
      );
    },
  });

  rl.registerAction("record.upsert", {
    access: "write",
    description:
      "Create or update a record based on matching fields (uses Airtable's performUpsert)",
    inputSchema: {
      baseId: { type: "string", required: true, description: "Base ID" },
      tableId: {
        type: "string",
        required: true,
        description: "Table ID or name",
      },
      fields: { type: "object", required: true, description: "Field values" },
      fieldsToMergeOn: {
        type: "array",
        required: true,
        description: "Field names to match on for upsert",
      },
      typecast: {
        type: "boolean",
        required: false,
        description: "Auto-typecast values",
      },
    },
    async execute(input, ctx) {
      const { baseId, tableId, fields, fieldsToMergeOn, typecast } = input as {
        baseId: string;
        tableId: string;
        fields: Record<string, unknown>;
        fieldsToMergeOn: string[];
        typecast?: boolean;
      };
      const body: Record<string, unknown> = {
        records: [{ fields }],
        performUpsert: { fieldsToMergeOn },
      };
      if (typecast) body.typecast = true;
      return apiRequest(getToken(ctx), "PATCH", `${baseId}/${tableId}`, body);
    },
  });

  rl.registerAction("record.delete", {
    access: "write",
    description: "Delete a record by ID",
    inputSchema: {
      baseId: { type: "string", required: true, description: "Base ID" },
      tableId: {
        type: "string",
        required: true,
        description: "Table ID or name",
      },
      recordId: { type: "string", required: true, description: "Record ID" },
    },
    async execute(input, ctx) {
      const { baseId, tableId, recordId } = input as {
        baseId: string;
        tableId: string;
        recordId: string;
      };
      return apiRequest(
        getToken(ctx),
        "DELETE",
        `${baseId}/${tableId}/${recordId}`,
      );
    },
  });
}
