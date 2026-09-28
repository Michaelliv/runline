import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { adaloCredential } from "./credentials.js";

/** A path beneath the connection's app, signed through the credential. */
function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  const appId = pathSegment(ctx.connection.config.appId);
  return credentialJson(ctx, adaloCredential, "adalo", {
    target: "api",
    path: `${appId}/${path}`,
    method,
    query,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

async function paginate(
  ctx: ActionContext,
  collectionId: string,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const data = (await apiRequest(
      ctx,
      "GET",
      `collections/${pathSegment(collectionId)}`,
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

export default function adalo(rl: RunlinePluginAPI) {
  rl.setName("adalo");
  rl.setVersion("0.1.0");
  rl.setCredential(adaloCredential);

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
      return apiRequest(
        ctx,
        "POST",
        `collections/${pathSegment(collectionId)}`,
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
      return apiRequest(
        ctx,
        "GET",
        `collections/${pathSegment(collectionId)}/${pathSegment(rowId)}`,
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
      return paginate(ctx, collectionId, limit);
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
      return apiRequest(
        ctx,
        "PUT",
        `collections/${pathSegment(collectionId)}/${pathSegment(rowId)}`,
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
      return apiRequest(
        ctx,
        "DELETE",
        `collections/${pathSegment(collectionId)}/${pathSegment(rowId)}`,
      );
    },
  });
}
