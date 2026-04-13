import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return { subdomain: c.subdomain as string, username: c.username as string, password: c.password as string };
}

async function api(conn: ReturnType<typeof getConn>, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`https://${conn.subdomain}.service-now.com/api${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Basic ${btoa(`${conn.username}:${conn.password}`)}`, "Content-Type": "application/json", Accept: "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`ServiceNow error ${res.status}: ${await res.text()}`);
  return res.json();
}

const TABLES: Record<string, string> = {
  incident: "incident", user: "sys_user", userGroup: "sys_user_group", userRole: "sys_user_role",
  businessService: "cmdb_ci_service", configurationItem: "cmdb_ci", department: "cmn_department",
};

function registerTableResource(rl: RunlinePluginAPI, resource: string, table: string, conn: typeof getConn) {
  rl.registerAction(`${resource}.create`, { description: `Create a ${resource}`, inputSchema: { data: { type: "object", required: true } },
    async execute(input, ctx) {
      const data = (await api(conn(ctx), "POST", `/now/table/${table}`, (input as Record<string, unknown>).data as Record<string, unknown>)) as Record<string, unknown>;
      return data.result;
    } });

  rl.registerAction(`${resource}.get`, { description: `Get a ${resource} by sys_id`, inputSchema: { sysId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(conn(ctx), "GET", `/now/table/${table}/${(input as Record<string, unknown>).sysId}`)) as Record<string, unknown>;
      return data.result;
    } });

  rl.registerAction(`${resource}.list`, { description: `List ${resource}s`, inputSchema: { limit: { type: "number", required: false }, query: { type: "string", required: false, description: "Encoded query string" }, fields: { type: "string", required: false, description: "Comma-separated fields" } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.sysparm_limit = p.limit;
      if (p.query) qs.sysparm_query = p.query;
      if (p.fields) qs.sysparm_fields = p.fields;
      const data = (await api(conn(ctx), "GET", `/now/table/${table}`, undefined, qs)) as Record<string, unknown>;
      return data.result;
    } });

  rl.registerAction(`${resource}.update`, { description: `Update a ${resource}`, inputSchema: { sysId: { type: "string", required: true }, data: { type: "object", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(conn(ctx), "PATCH", `/now/table/${table}/${p.sysId}`, p.data as Record<string, unknown>)) as Record<string, unknown>;
      return data.result;
    } });

  rl.registerAction(`${resource}.delete`, { description: `Delete a ${resource}`, inputSchema: { sysId: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(conn(ctx), "DELETE", `/now/table/${table}/${(input as Record<string, unknown>).sysId}`);
      return { success: true };
    } });
}

export default function servicenow(rl: RunlinePluginAPI) {
  rl.setName("servicenow");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    subdomain: { type: "string", required: true, description: "ServiceNow instance subdomain", env: "SERVICENOW_SUBDOMAIN" },
    username: { type: "string", required: true, description: "ServiceNow username", env: "SERVICENOW_USERNAME" },
    password: { type: "string", required: true, description: "ServiceNow password", env: "SERVICENOW_PASSWORD" },
  });

  for (const [resource, table] of Object.entries(TABLES)) {
    registerTableResource(rl, resource, table, getConn);
  }

  // ── Generic Table Record ────────────────────────────

  rl.registerAction("tableRecord.create", { description: "Create a record in any table", inputSchema: { tableName: { type: "string", required: true }, data: { type: "object", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(getConn(ctx), "POST", `/now/table/${p.tableName}`, p.data as Record<string, unknown>)) as Record<string, unknown>;
      return data.result;
    } });

  rl.registerAction("tableRecord.get", { description: "Get a record from any table", inputSchema: { tableName: { type: "string", required: true }, sysId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(getConn(ctx), "GET", `/now/table/${p.tableName}/${p.sysId}`)) as Record<string, unknown>;
      return data.result;
    } });

  rl.registerAction("tableRecord.list", { description: "List records from any table", inputSchema: { tableName: { type: "string", required: true }, limit: { type: "number", required: false }, query: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.sysparm_limit = p.limit;
      if (p.query) qs.sysparm_query = p.query;
      const data = (await api(getConn(ctx), "GET", `/now/table/${p.tableName}`, undefined, qs)) as Record<string, unknown>;
      return data.result;
    } });

  rl.registerAction("tableRecord.update", { description: "Update a record in any table", inputSchema: { tableName: { type: "string", required: true }, sysId: { type: "string", required: true }, data: { type: "object", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(getConn(ctx), "PATCH", `/now/table/${p.tableName}/${p.sysId}`, p.data as Record<string, unknown>)) as Record<string, unknown>;
      return data.result;
    } });

  rl.registerAction("tableRecord.delete", { description: "Delete a record from any table", inputSchema: { tableName: { type: "string", required: true }, sysId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await api(getConn(ctx), "DELETE", `/now/table/${p.tableName}/${p.sysId}`);
      return { success: true };
    } });
}
