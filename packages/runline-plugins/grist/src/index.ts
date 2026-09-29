import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { gristCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: unknown,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, gristCredential, "grist", {
    target: "api",
    path,
    method,
    query,
    ...(body !== undefined ? { json: body } : {}),
  });
}

export default function grist(rl: RunlinePluginAPI) {
  rl.setName("grist");
  rl.setVersion("0.1.0");
  rl.setCredential(gristCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Grist API key",
      env: "GRIST_API_KEY",
    },
    planType: {
      type: "string",
      required: false,
      description: "free (default), paid, or selfHosted",
      default: "free",
    },
    subdomain: {
      type: "string",
      required: false,
      description: "Subdomain for paid plan",
    },
    selfHostedUrl: {
      type: "string",
      required: false,
      description: "Full URL for self-hosted",
      env: "GRIST_URL",
    },
  });

  rl.registerAction("record.create", {
    access: "write",
    description: "Create records in a table",
    inputSchema: {
      docId: { type: "string", required: true, description: "Document ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      records: {
        type: "array",
        required: true,
        description: "Array of {fields: {col: value}} objects",
      },
    },
    async execute(input, ctx) {
      const { docId, tableId, records } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "POST",
        `docs/${pathSegment(docId)}/tables/${pathSegment(tableId)}/records`,
        { records },
      );
    },
  });

  rl.registerAction("record.list", {
    access: "read",
    description: "List records from a table",
    inputSchema: {
      docId: { type: "string", required: true, description: "Document ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      limit: { type: "number", required: false, description: "Max results" },
      sort: {
        type: "string",
        required: false,
        description: "Sort columns (e.g. 'Name,-Age')",
      },
      filter: {
        type: "object",
        required: false,
        description: "Filter as {column: [values]}",
      },
    },
    async execute(input, ctx) {
      const { docId, tableId, limit, sort, filter } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (limit) qs.limit = limit;
      if (sort) qs.sort = sort;
      if (filter) qs.filter = JSON.stringify(filter);
      const data = (await apiRequest(
        ctx,
        "GET",
        `docs/${pathSegment(docId)}/tables/${pathSegment(tableId)}/records`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.records;
    },
  });

  rl.registerAction("record.update", {
    access: "write",
    description: "Update records in a table",
    inputSchema: {
      docId: { type: "string", required: true, description: "Document ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      records: {
        type: "array",
        required: true,
        description: "Array of {id, fields: {col: value}} objects",
      },
    },
    async execute(input, ctx) {
      const { docId, tableId, records } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "PATCH",
        `docs/${pathSegment(docId)}/tables/${pathSegment(tableId)}/records`,
        { records },
      );
    },
  });

  rl.registerAction("record.delete", {
    access: "write",
    description: "Delete records from a table",
    inputSchema: {
      docId: { type: "string", required: true, description: "Document ID" },
      tableId: { type: "string", required: true, description: "Table ID" },
      rowIds: {
        type: "array",
        required: true,
        description: "Array of row IDs to delete",
      },
    },
    async execute(input, ctx) {
      const { docId, tableId, rowIds } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "POST",
        `docs/${pathSegment(docId)}/tables/${pathSegment(tableId)}/data/delete`,
        rowIds,
      );
    },
  });
}
