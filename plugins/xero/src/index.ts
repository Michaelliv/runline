import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.xero.com/api.xro/2.0";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return { accessToken: ctx.connection.config.accessToken as string, tenantId: ctx.connection.config.tenantId as string };
}

async function api(conn: ReturnType<typeof getConn>, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${conn.accessToken}`, "Xero-tenant-id": conn.tenantId, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Xero error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function xero(rl: RunlinePluginAPI) {
  rl.setName("xero");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "Xero OAuth2 access token", env: "XERO_ACCESS_TOKEN" },
    tenantId: { type: "string", required: true, description: "Xero tenant/organization ID", env: "XERO_TENANT_ID" },
  });

  // ── Invoice ─────────────────────────────────────────

  rl.registerAction("invoice.create", {
    description: "Create an invoice",
    inputSchema: {
      Type: { type: "string", required: true, description: "ACCREC (sales) or ACCPAY (bills)" },
      ContactID: { type: "string", required: true },
      LineItems: { type: "object", required: false, description: "Array of line items" },
      Status: { type: "string", required: false, description: "DRAFT, SUBMITTED, AUTHORISED" },
      Date: { type: "string", required: false },
      DueDate: { type: "string", required: false },
      Reference: { type: "string", required: false },
      CurrencyCode: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { Type: p.Type, Contact: { ContactID: p.ContactID } };
      if (p.LineItems) body.LineItems = p.LineItems;
      if (p.Status) body.Status = p.Status;
      if (p.Date) body.Date = p.Date;
      if (p.DueDate) body.DueDate = p.DueDate;
      if (p.Reference) body.Reference = p.Reference;
      if (p.CurrencyCode) body.CurrencyCode = p.CurrencyCode;
      const data = (await api(getConn(ctx), "POST", "/Invoices", body)) as Record<string, unknown>;
      return data.Invoices;
    },
  });

  rl.registerAction("invoice.get", {
    description: "Get an invoice by ID",
    inputSchema: { invoiceId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(getConn(ctx), "GET", `/Invoices/${(input as Record<string, unknown>).invoiceId}`)) as Record<string, unknown>;
      return data.Invoices;
    },
  });

  rl.registerAction("invoice.list", {
    description: "List invoices",
    inputSchema: { limit: { type: "number", required: false }, statuses: { type: "string", required: false, description: "Comma-separated statuses" }, where: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.statuses) qs.statuses = p.statuses;
      if (p.where) qs.where = p.where;
      const data = (await api(getConn(ctx), "GET", "/Invoices", undefined, qs)) as Record<string, unknown>;
      const invoices = data.Invoices as unknown[];
      return p.limit ? invoices.slice(0, p.limit as number) : invoices;
    },
  });

  rl.registerAction("invoice.update", {
    description: "Update an invoice",
    inputSchema: { invoiceId: { type: "string", required: true }, data: { type: "object", required: true, description: "Fields to update (Xero API format)" } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const result = (await api(getConn(ctx), "POST", `/Invoices/${p.invoiceId}`, p.data as Record<string, unknown>)) as Record<string, unknown>;
      return result.Invoices;
    },
  });

  // ── Contact ─────────────────────────────────────────

  rl.registerAction("contact.create", {
    description: "Create a contact",
    inputSchema: { Name: { type: "string", required: true }, EmailAddress: { type: "string", required: false }, FirstName: { type: "string", required: false }, LastName: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { Contacts: [p] };
      const data = (await api(getConn(ctx), "POST", "/Contacts", body)) as Record<string, unknown>;
      return data.Contacts;
    },
  });

  rl.registerAction("contact.get", {
    description: "Get a contact by ID",
    inputSchema: { contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(getConn(ctx), "GET", `/Contacts/${(input as Record<string, unknown>).contactId}`)) as Record<string, unknown>;
      return data.Contacts;
    },
  });

  rl.registerAction("contact.list", {
    description: "List contacts",
    inputSchema: { limit: { type: "number", required: false }, where: { type: "string", required: false }, includeArchived: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.where) qs.where = p.where;
      if (p.includeArchived) qs.includeArchived = "true";
      const data = (await api(getConn(ctx), "GET", "/Contacts", undefined, qs)) as Record<string, unknown>;
      const contacts = data.Contacts as unknown[];
      return p.limit ? contacts.slice(0, p.limit as number) : contacts;
    },
  });

  rl.registerAction("contact.update", {
    description: "Update a contact",
    inputSchema: { contactId: { type: "string", required: true }, data: { type: "object", required: true, description: "Fields to update (Xero API format)" } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { Contacts: [p.data] };
      const result = (await api(getConn(ctx), "POST", `/Contacts/${p.contactId}`, body)) as Record<string, unknown>;
      return result.Contacts;
    },
  });
}
