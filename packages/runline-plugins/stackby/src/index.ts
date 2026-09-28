import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { stackbyCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: unknown,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, stackbyCredential, "stackby", {
    target: "api",
    path: endpoint,
    method,
    query: qs,
    ...(body !== undefined ? { json: body } : {}),
  });
}

export default function stackby(rl: RunlinePluginAPI) {
  rl.setName("stackby");
  rl.setVersion("0.1.0");
  rl.setCredential(stackbyCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Stackby API key",
      env: "STACKBY_API_KEY",
    },
  });

  rl.registerAction("row.read", {
    access: "read",
    description: "Read a row by ID",
    inputSchema: {
      stackId: { type: "string", required: true },
      table: { type: "string", required: true },
      rowId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "GET",
        `rowlist/${pathSegment(p.stackId)}/${pathSegment(p.table)}`,
        undefined,
        { rowIds: p.rowId },
      )) as Array<Record<string, unknown>>;
      return data.map((d) => d.field);
    },
  });

  rl.registerAction("row.list", {
    access: "read",
    description: "List rows from a table",
    inputSchema: {
      stackId: { type: "string", required: true },
      table: { type: "string", required: true },
      view: { type: "string", required: false },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.view) qs.view = p.view;
      if (p.limit) qs.maxrecord = p.limit;
      const data = (await apiRequest(
        ctx,
        "GET",
        `rowlist/${pathSegment(p.stackId)}/${pathSegment(p.table)}`,
        undefined,
        qs,
      )) as Array<Record<string, unknown>>;
      return data.map((d) => d.field);
    },
  });

  rl.registerAction("row.append", {
    access: "write",
    description: "Append rows to a table",
    inputSchema: {
      stackId: { type: "string", required: true },
      table: { type: "string", required: true },
      records: {
        type: "object",
        required: true,
        description: "Array of objects [{field: {col1: val1, col2: val2}}]",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "POST",
        `rowcreate/${pathSegment(p.stackId)}/${pathSegment(p.table)}`,
        { records: p.records },
      )) as Array<Record<string, unknown>>;
      return data.map((d) => d.field);
    },
  });

  rl.registerAction("row.delete", {
    access: "write",
    description: "Delete a row by ID",
    inputSchema: {
      stackId: { type: "string", required: true },
      table: { type: "string", required: true },
      rowId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "DELETE",
        `rowdelete/${pathSegment(p.stackId)}/${pathSegment(p.table)}`,
        undefined,
        { rowIds: p.rowId },
      );
    },
  });
}
