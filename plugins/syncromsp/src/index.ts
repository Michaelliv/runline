import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const subdomain = ctx.connection.config.subdomain as string;
  const apiKey = ctx.connection.config.apiKey as string;
  return { base: `https://${subdomain}.syncromsp.com/api/v1`, apiKey };
}

async function api(base: string, apiKey: string, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${base}/${endpoint}`);
  url.searchParams.set("api_key", apiKey);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`SyncroMSP error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : { success: true };
}

async function paginate(base: string, apiKey: string, endpoint: string, key: string, qs: Record<string, unknown> = {}): Promise<unknown[]> {
  const results: unknown[] = [];
  let page = 1;
  let batch: unknown[];
  do {
    qs.page = page;
    const res = await api(base, apiKey, "GET", endpoint, undefined, qs) as Record<string, unknown>;
    batch = (res[key] ?? []) as unknown[];
    results.push(...batch);
    page++;
  } while (batch.length > 0);
  return results;
}

export default function syncromsp(rl: RunlinePluginAPI) {
  rl.setName("syncromsp");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    subdomain: { type: "string", required: true, description: "SyncroMSP subdomain", env: "SYNCROMSP_SUBDOMAIN" },
    apiKey: { type: "string", required: true, description: "API key", env: "SYNCROMSP_API_KEY" },
  });

  // ── Customer ────────────────────────────────────────

  rl.registerAction("customer.create", { description: "Create a customer",
    inputSchema: { email: { type: "string", required: true }, businessName: { type: "string", required: false }, firstName: { type: "string", required: false }, lastname: { type: "string", required: false }, phone: { type: "string", required: false }, notes: { type: "string", required: false }, address: { type: "string", required: false }, city: { type: "string", required: false }, state: { type: "string", required: false }, zip: { type: "string", required: false } },
    async execute(input, ctx) {
      const { base, apiKey } = getConn(ctx);
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { email: p.email };
      if (p.businessName) body.business_name = p.businessName;
      if (p.firstName) body.firstname = p.firstName;
      if (p.lastname) body.lastname = p.lastname;
      if (p.phone) body.phone = p.phone;
      if (p.notes) body.notes = p.notes;
      if (p.address) body.address = p.address;
      if (p.city) body.city = p.city;
      if (p.state) body.state = p.state;
      if (p.zip) body.zip = p.zip;
      const res = await api(base, apiKey, "POST", "customers", body) as Record<string, unknown>;
      return res.customer ?? res;
    } });

  rl.registerAction("customer.get", { description: "Get a customer", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { base, apiKey } = getConn(ctx); const res = await api(base, apiKey, "GET", `customers/${(input as Record<string, unknown>).id}`) as Record<string, unknown>; return res.customer ?? res; } });

  rl.registerAction("customer.list", { description: "List customers",
    inputSchema: { limit: { type: "number", required: false }, businessName: { type: "string", required: false }, includeDisabled: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const { base, apiKey } = getConn(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.businessName) qs.business_name = p.businessName;
      if (p.includeDisabled) qs.include_disabled = true;
      if (p.limit) { qs.per_page = p.limit; const res = await api(base, apiKey, "GET", "customers", undefined, qs) as Record<string, unknown>; return res.customers ?? res; }
      return paginate(base, apiKey, "customers", "customers", qs);
    } });

  rl.registerAction("customer.update", { description: "Update a customer",
    inputSchema: { id: { type: "string", required: true }, email: { type: "string", required: false }, businessName: { type: "string", required: false }, firstName: { type: "string", required: false }, lastname: { type: "string", required: false }, phone: { type: "string", required: false }, notes: { type: "string", required: false } },
    async execute(input, ctx) {
      const { base, apiKey } = getConn(ctx);
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.email) body.email = fields.email;
      if (fields.businessName) body.business_name = fields.businessName;
      if (fields.firstName) body.firstname = fields.firstName;
      if (fields.lastname) body.lastname = fields.lastname;
      if (fields.phone) body.phone = fields.phone;
      if (fields.notes) body.notes = fields.notes;
      const res = await api(base, apiKey, "PUT", `customers/${id}`, body) as Record<string, unknown>;
      return res.customer ?? res;
    } });

  rl.registerAction("customer.delete", { description: "Delete a customer", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { base, apiKey } = getConn(ctx); await api(base, apiKey, "DELETE", `customers/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  // ── Contact ─────────────────────────────────────────

  rl.registerAction("contact.create", { description: "Create a contact",
    inputSchema: { customerId: { type: "string", required: true }, email: { type: "string", required: true }, name: { type: "string", required: false }, phone: { type: "string", required: false }, notes: { type: "string", required: false } },
    async execute(input, ctx) {
      const { base, apiKey } = getConn(ctx);
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { customer_id: p.customerId, email: p.email };
      if (p.name) body.name = p.name;
      if (p.phone) body.phone = p.phone;
      if (p.notes) body.notes = p.notes;
      return api(base, apiKey, "POST", "contacts", body);
    } });

  rl.registerAction("contact.get", { description: "Get a contact", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { base, apiKey } = getConn(ctx); return api(base, apiKey, "GET", `contacts/${(input as Record<string, unknown>).id}`); } });

  rl.registerAction("contact.list", { description: "List contacts",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const { base, apiKey } = getConn(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      if (p.limit) { const res = await api(base, apiKey, "GET", "contacts") as Record<string, unknown>; return ((res.contacts ?? []) as unknown[]).slice(0, p.limit as number); }
      return paginate(base, apiKey, "contacts", "contacts");
    } });

  rl.registerAction("contact.update", { description: "Update a contact",
    inputSchema: { id: { type: "string", required: true }, customerId: { type: "string", required: false }, email: { type: "string", required: false }, name: { type: "string", required: false }, phone: { type: "string", required: false }, notes: { type: "string", required: false } },
    async execute(input, ctx) {
      const { base, apiKey } = getConn(ctx);
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.customerId) body.customer_id = fields.customerId;
      if (fields.email) body.email = fields.email;
      if (fields.name) body.name = fields.name;
      if (fields.phone) body.phone = fields.phone;
      if (fields.notes) body.notes = fields.notes;
      return api(base, apiKey, "PUT", `contacts/${id}`, body);
    } });

  rl.registerAction("contact.delete", { description: "Delete a contact", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { base, apiKey } = getConn(ctx); await api(base, apiKey, "DELETE", `contacts/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  // ── Ticket ──────────────────────────────────────────

  rl.registerAction("ticket.create", { description: "Create a ticket",
    inputSchema: { customerId: { type: "string", required: true }, subject: { type: "string", required: true }, issueType: { type: "string", required: false }, status: { type: "string", required: false }, assetId: { type: "string", required: false }, contactId: { type: "string", required: false } },
    async execute(input, ctx) {
      const { base, apiKey } = getConn(ctx);
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { customer_id: p.customerId, subject: p.subject };
      if (p.issueType) body.problem_type = p.issueType;
      if (p.status) body.status = p.status;
      if (p.assetId) body.asset_id = p.assetId;
      if (p.contactId) body.contact_id = p.contactId;
      const res = await api(base, apiKey, "POST", "tickets", body) as Record<string, unknown>;
      return res.ticket ?? res;
    } });

  rl.registerAction("ticket.get", { description: "Get a ticket", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { base, apiKey } = getConn(ctx); const res = await api(base, apiKey, "GET", `tickets/${(input as Record<string, unknown>).id}`) as Record<string, unknown>; return res.ticket ?? res; } });

  rl.registerAction("ticket.list", { description: "List tickets",
    inputSchema: { limit: { type: "number", required: false }, status: { type: "string", required: false } },
    async execute(input, ctx) {
      const { base, apiKey } = getConn(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.status) qs.status = p.status;
      if (p.limit) { qs.per_page = p.limit; const res = await api(base, apiKey, "GET", "tickets", undefined, qs) as Record<string, unknown>; return res.tickets ?? res; }
      return paginate(base, apiKey, "tickets", "tickets", qs);
    } });

  rl.registerAction("ticket.update", { description: "Update a ticket",
    inputSchema: { id: { type: "string", required: true }, subject: { type: "string", required: false }, status: { type: "string", required: false }, issueType: { type: "string", required: false }, customerId: { type: "string", required: false }, assetId: { type: "string", required: false }, dueDate: { type: "string", required: false }, contactId: { type: "string", required: false } },
    async execute(input, ctx) {
      const { base, apiKey } = getConn(ctx);
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.subject) body.subject = fields.subject;
      if (fields.status) body.status = fields.status;
      if (fields.issueType) body.problem_type = fields.issueType;
      if (fields.customerId) body.customer_id = fields.customerId;
      if (fields.assetId) body.asset_id = fields.assetId;
      if (fields.dueDate) body.due_date = fields.dueDate;
      if (fields.contactId) body.contact_id = fields.contactId;
      const res = await api(base, apiKey, "PUT", `tickets/${id}`, body) as Record<string, unknown>;
      return res.ticket ?? res;
    } });

  rl.registerAction("ticket.delete", { description: "Delete a ticket", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { base, apiKey } = getConn(ctx); await api(base, apiKey, "DELETE", `tickets/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  // ── RMM Alerts ──────────────────────────────────────

  rl.registerAction("rmmAlert.create", { description: "Create an RMM alert",
    inputSchema: { customerId: { type: "string", required: true }, assetId: { type: "string", required: true }, description: { type: "string", required: true } },
    async execute(input, ctx) {
      const { base, apiKey } = getConn(ctx);
      const p = input as Record<string, unknown>;
      const res = await api(base, apiKey, "POST", "rmm_alerts", { customer_id: p.customerId, asset_id: p.assetId, description: p.description }) as Record<string, unknown>;
      return res.alert ?? res;
    } });

  rl.registerAction("rmmAlert.get", { description: "Get an RMM alert", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { base, apiKey } = getConn(ctx); const res = await api(base, apiKey, "GET", `rmm_alerts/${(input as Record<string, unknown>).id}`) as Record<string, unknown>; return res.rmm_alert ?? res; } });

  rl.registerAction("rmmAlert.list", { description: "List RMM alerts",
    inputSchema: { limit: { type: "number", required: false }, status: { type: "string", required: false, description: "all, active, or resolved" } },
    async execute(input, ctx) {
      const { base, apiKey } = getConn(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { status: p.status ?? "all" };
      if (p.limit) { qs.per_page = p.limit; const res = await api(base, apiKey, "GET", "rmm_alerts", undefined, qs) as Record<string, unknown>; return res.rmm_alerts ?? res; }
      return paginate(base, apiKey, "rmm_alerts", "rmm_alerts", qs);
    } });

  rl.registerAction("rmmAlert.delete", { description: "Delete an RMM alert", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { base, apiKey } = getConn(ctx); await api(base, apiKey, "DELETE", `rmm_alerts/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  rl.registerAction("rmmAlert.mute", { description: "Mute an RMM alert",
    inputSchema: { id: { type: "string", required: true }, muteFor: { type: "string", required: true, description: "Duration to mute, e.g. 1_hour, 1_day, forever" } },
    async execute(input, ctx) {
      const { base, apiKey } = getConn(ctx);
      const p = input as Record<string, unknown>;
      return api(base, apiKey, "POST", `rmm_alerts/${p.id}/mute`, { id: p.id, mute_for: p.muteFor });
    } });
}
