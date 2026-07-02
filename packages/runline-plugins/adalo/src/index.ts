import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  appId: string,
  apiKey: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`https://api.adalo.com/v0/apps/${appId}${path}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  };
  if (body && Object.keys(body).length > 0) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Adalo API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return { success: true };
  return res.json();
}

async function paginate(
  appId: string,
  apiKey: string,
  collectionId: string,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const data = (await apiRequest(
      appId,
      apiKey,
      "GET",
      `/collections/${collectionId}`,
      undefined,
      {
        limit: pageSize,
        offset,
      },
    )) as { records?: unknown[] };

    const items = data.records ?? [];
    results.push(...items);

    if (limit && results.length >= limit) return results.slice(0, limit);
    if (items.length < pageSize) break;
    offset += items.length;
  }

  return results;
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    appId: ctx.connection.config.appId as string,
    apiKey: ctx.connection.config.apiKey as string,
  };
}

export default function adalo(rl: RunlinePluginAPI) {
  rl.setName("adalo");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    appId: {
      type: "string",
      required: true,
      description: "Adalo application ID",
      env: "ADALO_APP_ID",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "Adalo API key",
      env: "ADALO_API_KEY",
    },
  });

  rl.registerAction("collection.create", {
    access: "write",
    description: "Create a row in a collection",
    inputSchema: {
      collectionId: {
        type: "string",
        required: true,
        description: "Collection ID",
      },
      fields: {
        type: "object",
        required: true,
        description: "Field values as key-value pairs",
      },
    },
    async execute(input, ctx) {
      const { collectionId, fields } = input as {
        collectionId: string;
        fields: Record<string, unknown>;
      };
      const { appId, apiKey } = getConn(ctx);
      return apiRequest(
        appId,
        apiKey,
        "POST",
        `/collections/${collectionId}`,
        fields,
      );
    },
  });

  rl.registerAction("collection.get", {
    access: "read",
    description: "Get a row from a collection",
    inputSchema: {
      collectionId: {
        type: "string",
        required: true,
        description: "Collection ID",
      },
      rowId: { type: "string", required: true, description: "Row ID" },
    },
    async execute(input, ctx) {
      const { collectionId, rowId } = input as {
        collectionId: string;
        rowId: string;
      };
      const { appId, apiKey } = getConn(ctx);
      return apiRequest(
        appId,
        apiKey,
        "GET",
        `/collections/${collectionId}/${rowId}`,
      );
    },
  });

  rl.registerAction("collection.list", {
    access: "read",
    description: "List rows from a collection",
    inputSchema: {
      collectionId: {
        type: "string",
        required: true,
        description: "Collection ID",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { collectionId, limit } = input as {
        collectionId: string;
        limit?: number;
      };
      const { appId, apiKey } = getConn(ctx);
      return paginate(appId, apiKey, collectionId, limit);
    },
  });

  rl.registerAction("collection.update", {
    access: "write",
    description: "Update a row in a collection",
    inputSchema: {
      collectionId: {
        type: "string",
        required: true,
        description: "Collection ID",
      },
      rowId: { type: "string", required: true, description: "Row ID" },
      fields: {
        type: "object",
        required: true,
        description: "Field values to update",
      },
    },
    async execute(input, ctx) {
      const { collectionId, rowId, fields } = input as {
        collectionId: string;
        rowId: string;
        fields: Record<string, unknown>;
      };
      const { appId, apiKey } = getConn(ctx);
      return apiRequest(
        appId,
        apiKey,
        "PUT",
        `/collections/${collectionId}/${rowId}`,
        fields,
      );
    },
  });

  rl.registerAction("collection.delete", {
    access: "write",
    description: "Delete a row from a collection",
    inputSchema: {
      collectionId: {
        type: "string",
        required: true,
        description: "Collection ID",
      },
      rowId: { type: "string", required: true, description: "Row ID" },
    },
    async execute(input, ctx) {
      const { collectionId, rowId } = input as {
        collectionId: string;
        rowId: string;
      };
      const { appId, apiKey } = getConn(ctx);
      return apiRequest(
        appId,
        apiKey,
        "DELETE",
        `/collections/${collectionId}/${rowId}`,
      );
    },
  });
}
