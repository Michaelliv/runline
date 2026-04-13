import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  const sandbox = c.sandbox === true;
  const base = sandbox ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
  return { base, accessToken: c.accessToken as string, companyId: c.companyId as string };
}

async function api(conn: ReturnType<typeof getConn>, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${conn.base}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${conn.accessToken}`, Accept: "application/json", "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`QuickBooks error ${res.status}: ${await res.text()}`);
  return res.json();
}

function capitalCase(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function registerQbResource(rl: RunlinePluginAPI, resource: string, conn: typeof getConn) {
  const cap = capitalCase(resource);
  const prefix = (c: ReturnType<typeof getConn>) => `/v3/company/${c.companyId}`;

  rl.registerAction(`${resource}.create`, { description: `Create a ${resource}`, inputSchema: { data: { type: "object", required: true } },
    async execute(input, ctx) {
      const c = conn(ctx);
      return api(c, "POST", `${prefix(c)}/${resource}`, (input as Record<string, unknown>).data as Record<string, unknown>);
    } });

  rl.registerAction(`${resource}.get`, { description: `Get a ${resource} by ID`, inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const c = conn(ctx);
      const data = (await api(c, "GET", `${prefix(c)}/${resource}/${(input as Record<string, unknown>).id}`)) as Record<string, unknown>;
      return data[cap];
    } });

  rl.registerAction(`${resource}.query`, { description: `Query ${resource}s (SQL-like)`, inputSchema: { query: { type: "string", required: false, description: `WHERE clause (default: SELECT * FROM ${cap})` }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const c = conn(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      let q = `SELECT * FROM ${cap}`;
      if (p.query) q += ` ${p.query}`;
      if (p.limit) q += ` MAXRESULTS ${p.limit}`;
      const data = (await api(c, "GET", `${prefix(c)}/query`, undefined, { query: q })) as Record<string, unknown>;
      return (data.QueryResponse as Record<string, unknown>)?.[cap] ?? [];
    } });

  rl.registerAction(`${resource}.update`, { description: `Update a ${resource} (must include Id and SyncToken)`, inputSchema: { data: { type: "object", required: true } },
    async execute(input, ctx) {
      const c = conn(ctx);
      return api(c, "POST", `${prefix(c)}/${resource}`, (input as Record<string, unknown>).data as Record<string, unknown>);
    } });

  rl.registerAction(`${resource}.delete`, { description: `Delete a ${resource}`, inputSchema: { id: { type: "string", required: true }, syncToken: { type: "string", required: true } },
    async execute(input, ctx) {
      const c = conn(ctx);
      const p = input as Record<string, unknown>;
      return api(c, "POST", `${prefix(c)}/${resource}`, { Id: p.id, SyncToken: p.syncToken }, { operation: "delete" });
    } });
}

export default function quickbooks(rl: RunlinePluginAPI) {
  rl.setName("quickbooks");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "QuickBooks OAuth2 access token", env: "QUICKBOOKS_ACCESS_TOKEN" },
    companyId: { type: "string", required: true, description: "QuickBooks Company/Realm ID", env: "QUICKBOOKS_COMPANY_ID" },
    sandbox: { type: "boolean", required: false, description: "Use sandbox environment", env: "QUICKBOOKS_SANDBOX" },
  });

  for (const resource of ["bill", "customer", "employee", "estimate", "invoice", "item", "payment", "purchase", "vendor"]) {
    registerQbResource(rl, resource, getConn);
  }
}
