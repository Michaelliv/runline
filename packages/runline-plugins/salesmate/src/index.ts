import type { RunlinePluginAPI } from "runline";

const BASE = "https://apis.salesmate.io";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    sessionToken: ctx.connection.config.sessionToken as string,
    linkname: ctx.connection.config.linkname as string,
  };
}

async function api(
  conn: ReturnType<typeof getConn>,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      sessionToken: conn.sessionToken,
      "x-linkname": conn.linkname,
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok)
    throw new Error(`Salesmate error ${res.status}: ${await res.text()}`);
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
      const data = (await api(
        conn(ctx),
        "POST",
        `/v1/${plural}`,
        input as Record<string, unknown>,
      )) as Record<string, unknown>;
      return data.Data;
    },
  });

  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource} by ID`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(
        conn(ctx),
        "GET",
        `/v1/${plural}/${(input as Record<string, unknown>).id}`,
      )) as Record<string, unknown>;
      return data.Data;
    },
  });

  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `Search/list ${plural}`,
    inputSchema: {
      limit: { type: "number", required: false },
      fields: {
        type: "object",
        required: false,
        description: "Array of field names to return",
      },
      query: {
        type: "object",
        required: false,
        description: "Search query object",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {
        fields: p.fields ?? ["name", "id"],
        query: p.query ?? {},
      };
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.rows = p.limit;
      const data = (await api(
        conn(ctx),
        "POST",
        `/v2/${plural}/search`,
        body,
        qs,
      )) as Record<string, unknown>;
      return (data.Data as Record<string, unknown>).data;
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
      const data = (await api(
        conn(ctx),
        "PUT",
        `/v1/${plural}/${p.id}`,
        p.data as Record<string, unknown>,
      )) as Record<string, unknown>;
      return data.Data;
    },
  });

  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        conn(ctx),
        "DELETE",
        `/v1/${plural}/${(input as Record<string, unknown>).id}`,
      );
    },
  });
}

export default function salesmate(rl: RunlinePluginAPI) {
  rl.setName("salesmate");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    sessionToken: {
      type: "string",
      required: true,
      description: "Salesmate session token",
      env: "SALESMATE_SESSION_TOKEN",
    },
    linkname: {
      type: "string",
      required: true,
      description: "Salesmate workspace linkname (subdomain)",
      env: "SALESMATE_LINKNAME",
    },
  });

  registerCrud(rl, "company", "companies", getConn, {
    name: { type: "string", required: true },
    owner: { type: "number", required: true },
    website: { type: "string", required: false },
    phone: { type: "string", required: false },
    description: { type: "string", required: false },
  });

  registerCrud(rl, "activity", "activities", getConn, {
    title: { type: "string", required: true },
    owner: { type: "number", required: true },
    type: {
      type: "string",
      required: true,
      description: "e.g. call, email, task",
    },
    description: { type: "string", required: false },
    dueDate: { type: "string", required: false },
  });

  registerCrud(rl, "deal", "deals", getConn, {
    title: { type: "string", required: true },
    owner: { type: "number", required: true },
    primaryContact: { type: "number", required: true },
    pipeline: { type: "string", required: true },
    status: { type: "string", required: true },
    stage: { type: "string", required: true },
    currency: { type: "string", required: true },
    dealValue: { type: "number", required: false },
    description: { type: "string", required: false },
  });
}
