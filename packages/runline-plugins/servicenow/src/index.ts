import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { servicenowCredential } from "./credentials.js";

/** A table name or sys_id as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function api(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, servicenowCredential, "servicenow", {
    target: "api",
    path,
    method,
    query,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

const TABLES: Record<string, string> = {
  incident: "incident",
  user: "sys_user",
  userGroup: "sys_user_group",
  userRole: "sys_user_role",
  businessService: "cmdb_ci_service",
  configurationItem: "cmdb_ci",
  department: "cmn_department",
};

function registerTableResource(
  rl: RunlinePluginAPI,
  resource: string,
  table: string,
) {
  rl.registerAction(`${resource}.create`, {
    access: "write",
    description: `Create a ${resource}`,
    inputSchema: { data: { type: "object", required: true } },
    async execute(input, ctx) {
      const data = (await api(
        ctx,
        "POST",
        `now/table/${seg(table)}`,
        (input as Record<string, unknown>).data as Record<string, unknown>,
      )) as Record<string, unknown>;
      return data.result;
    },
  });

  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource} by sys_id`,
    inputSchema: { sysId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(
        ctx,
        "GET",
        `now/table/${seg(table)}/${seg((input as Record<string, unknown>).sysId)}`,
      )) as Record<string, unknown>;
      return data.result;
    },
  });

  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `List ${resource}s`,
    inputSchema: {
      limit: { type: "number", required: false },
      query: {
        type: "string",
        required: false,
        description: "Encoded query string",
      },
      fields: {
        type: "string",
        required: false,
        description: "Comma-separated fields",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.sysparm_limit = p.limit;
      if (p.query) qs.sysparm_query = p.query;
      if (p.fields) qs.sysparm_fields = p.fields;
      const data = (await api(
        ctx,
        "GET",
        `now/table/${seg(table)}`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.result;
    },
  });

  rl.registerAction(`${resource}.update`, {
    access: "write",
    description: `Update a ${resource}`,
    inputSchema: {
      sysId: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(
        ctx,
        "PATCH",
        `now/table/${seg(table)}/${seg(p.sysId)}`,
        p.data as Record<string, unknown>,
      )) as Record<string, unknown>;
      return data.result;
    },
  });

  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: { sysId: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `now/table/${seg(table)}/${seg((input as Record<string, unknown>).sysId)}`,
      );
      return { success: true };
    },
  });
}

export default function servicenow(rl: RunlinePluginAPI) {
  rl.setName("servicenow");
  rl.setVersion("0.1.0");
  rl.setCredential(servicenowCredential);
  rl.setConnectionSchema({
    subdomain: {
      type: "string",
      required: true,
      description: "ServiceNow instance subdomain",
      env: "SERVICENOW_SUBDOMAIN",
    },
    username: {
      type: "string",
      required: true,
      description: "ServiceNow username",
      env: "SERVICENOW_USERNAME",
    },
    password: {
      type: "string",
      required: true,
      description: "ServiceNow password",
      env: "SERVICENOW_PASSWORD",
    },
  });

  for (const [resource, table] of Object.entries(TABLES)) {
    registerTableResource(rl, resource, table);
  }

  // ── Generic Table Record ────────────────────────────

  rl.registerAction("tableRecord.create", {
    access: "write",
    description: "Create a record in any table",
    inputSchema: {
      tableName: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(
        ctx,
        "POST",
        `now/table/${seg(p.tableName)}`,
        p.data as Record<string, unknown>,
      )) as Record<string, unknown>;
      return data.result;
    },
  });

  rl.registerAction("tableRecord.get", {
    access: "read",
    description: "Get a record from any table",
    inputSchema: {
      tableName: { type: "string", required: true },
      sysId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(
        ctx,
        "GET",
        `now/table/${seg(p.tableName)}/${seg(p.sysId)}`,
      )) as Record<string, unknown>;
      return data.result;
    },
  });

  rl.registerAction("tableRecord.list", {
    access: "read",
    description: "List records from any table",
    inputSchema: {
      tableName: { type: "string", required: true },
      limit: { type: "number", required: false },
      query: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.sysparm_limit = p.limit;
      if (p.query) qs.sysparm_query = p.query;
      const data = (await api(
        ctx,
        "GET",
        `now/table/${seg(p.tableName)}`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.result;
    },
  });

  rl.registerAction("tableRecord.update", {
    access: "write",
    description: "Update a record in any table",
    inputSchema: {
      tableName: { type: "string", required: true },
      sysId: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(
        ctx,
        "PATCH",
        `now/table/${seg(p.tableName)}/${seg(p.sysId)}`,
        p.data as Record<string, unknown>,
      )) as Record<string, unknown>;
      return data.result;
    },
  });

  rl.registerAction("tableRecord.delete", {
    access: "write",
    description: "Delete a record from any table",
    inputSchema: {
      tableName: { type: "string", required: true },
      sysId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await api(ctx, "DELETE", `now/table/${seg(p.tableName)}/${seg(p.sysId)}`);
      return { success: true };
    },
  });
}
