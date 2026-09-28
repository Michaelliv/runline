import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { quickbaseCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: unknown,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, quickbaseCredential, "quickbase", {
    target: "api",
    path: endpoint,
    method,
    query: qs,
    headers: {
      "QB-Realm-Hostname": String(ctx.connection.config.hostname ?? ""),
    },
    ...(body !== undefined ? { json: body } : {}),
  });
}

export default function quickbase(rl: RunlinePluginAPI) {
  rl.setName("quickbase");
  rl.setVersion("0.1.0");
  rl.setCredential(quickbaseCredential);

  rl.setConnectionSchema({
    hostname: {
      type: "string",
      required: true,
      description: "QuickBase realm hostname (e.g. mycompany.quickbase.com)",
      env: "QUICKBASE_HOSTNAME",
    },
    userToken: {
      type: "string",
      required: true,
      description: "QuickBase user token",
      env: "QUICKBASE_USER_TOKEN",
    },
  });

  rl.registerAction("field.list", {
    access: "read",
    description: "List all fields for a table",
    inputSchema: {
      tableId: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(ctx, "GET", "fields", undefined, {
        tableId: p.tableId,
      })) as unknown[];
      if (p.limit) return data.slice(0, p.limit as number);
      return data;
    },
  });

  rl.registerAction("file.delete", {
    access: "write",
    description: "Delete a file attachment",
    inputSchema: {
      tableId: { type: "string", required: true },
      recordId: { type: "string", required: true },
      fieldId: { type: "string", required: true },
      versionNumber: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { tableId, recordId, fieldId, versionNumber } = input as Record<
        string,
        unknown
      >;
      return apiRequest(
        ctx,
        "DELETE",
        `files/${seg(tableId)}/${seg(recordId)}/${seg(fieldId)}/${seg(versionNumber)}`,
      );
    },
  });

  rl.registerAction("record.create", {
    access: "write",
    description: "Create records in a QuickBase table",
    inputSchema: {
      tableId: { type: "string", required: true },
      data: {
        type: "object",
        required: true,
        description:
          'Array of record objects with field IDs as keys, e.g. [{"6": {"value": "test"}}]',
      },
      fieldsToReturn: {
        type: "object",
        required: false,
        description: "Array of field IDs to return (default: [3])",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { to: p.tableId, data: p.data };
      body.fieldsToReturn = (p.fieldsToReturn as number[]) ?? [3];
      return apiRequest(ctx, "POST", "records", body);
    },
  });

  rl.registerAction("record.delete", {
    access: "write",
    description: "Delete records matching a query",
    inputSchema: {
      tableId: { type: "string", required: true },
      where: {
        type: "string",
        required: true,
        description: "Query string, e.g. {3.EX.123}",
      },
    },
    async execute(input, ctx) {
      const { tableId, where } = input as Record<string, unknown>;
      return apiRequest(ctx, "DELETE", "records", {
        from: tableId,
        where,
      });
    },
  });

  rl.registerAction("record.query", {
    access: "read",
    description: "Query records from a table",
    inputSchema: {
      tableId: { type: "string", required: true },
      where: {
        type: "string",
        required: false,
        description: "Query string filter",
      },
      select: {
        type: "object",
        required: false,
        description: "Array of field IDs to return",
      },
      sortBy: {
        type: "object",
        required: false,
        description: "Array of sort objects [{fieldId, order: 'ASC'|'DESC'}]",
      },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = { from: p.tableId };
      if (p.where) body.where = p.where;
      if (p.select) body.select = p.select;
      if (p.sortBy) body.sortBy = p.sortBy;
      if (p.limit) body.options = { top: p.limit };
      return apiRequest(ctx, "POST", "records/query", body);
    },
  });

  rl.registerAction("record.upsert", {
    access: "write",
    description: "Create or update records (upsert) using a merge field",
    inputSchema: {
      tableId: { type: "string", required: true },
      mergeFieldId: {
        type: "number",
        required: true,
        description: "Field ID used as the merge key",
      },
      data: {
        type: "object",
        required: true,
        description: "Array of record objects",
      },
      fieldsToReturn: {
        type: "object",
        required: false,
        description: "Array of field IDs to return",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        to: p.tableId,
        data: p.data,
        mergeFieldId: p.mergeFieldId,
      };
      body.fieldsToReturn = (p.fieldsToReturn as number[]) ?? [3];
      return apiRequest(ctx, "POST", "records", body);
    },
  });

  rl.registerAction("report.get", {
    access: "read",
    description: "Get report metadata",
    inputSchema: {
      tableId: { type: "string", required: true },
      reportId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { tableId, reportId } = input as Record<string, unknown>;
      return apiRequest(ctx, "GET", `reports/${seg(reportId)}`, undefined, {
        tableId,
      });
    },
  });

  rl.registerAction("report.run", {
    access: "read",
    description: "Run a report and get results",
    inputSchema: {
      tableId: { type: "string", required: true },
      reportId: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { tableId: p.tableId };
      if (p.limit) qs.top = p.limit;
      return apiRequest(ctx, "POST", `reports/${seg(p.reportId)}/run`, {}, qs);
    },
  });
}
