import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { xeroCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function api(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, xeroCredential, "xero", {
    target: "api",
    path: endpoint,
    method,
    query: qs,
    headers: { "Xero-tenant-id": ctx.connection.config.tenantId as string },
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

export default function xero(rl: RunlinePluginAPI) {
  rl.setName("xero");
  rl.setVersion("0.1.0");
  rl.setCredential(xeroCredential);
  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Xero OAuth2 access token",
      env: "XERO_ACCESS_TOKEN",
    },
    tenantId: {
      type: "string",
      required: true,
      description: "Xero tenant/organization ID",
      env: "XERO_TENANT_ID",
    },
  });

  // ── Invoice ─────────────────────────────────────────

  rl.registerAction("invoice.create", {
    access: "write",
    description: "Create an invoice",
    inputSchema: {
      Type: {
        type: "string",
        required: true,
        description: "ACCREC (sales) or ACCPAY (bills)",
      },
      ContactID: { type: "string", required: true },
      LineItems: {
        type: "object",
        required: false,
        description: "Array of line items",
      },
      Status: {
        type: "string",
        required: false,
        description: "DRAFT, SUBMITTED, AUTHORISED",
      },
      Date: { type: "string", required: false },
      DueDate: { type: "string", required: false },
      Reference: { type: "string", required: false },
      CurrencyCode: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        Type: p.Type,
        Contact: { ContactID: p.ContactID },
      };
      if (p.LineItems) body.LineItems = p.LineItems;
      if (p.Status) body.Status = p.Status;
      if (p.Date) body.Date = p.Date;
      if (p.DueDate) body.DueDate = p.DueDate;
      if (p.Reference) body.Reference = p.Reference;
      if (p.CurrencyCode) body.CurrencyCode = p.CurrencyCode;
      const data = (await api(ctx, "POST", "Invoices", body)) as Record<
        string,
        unknown
      >;
      return data.Invoices;
    },
  });

  rl.registerAction("invoice.get", {
    access: "read",
    description: "Get an invoice by ID",
    inputSchema: { invoiceId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(
        ctx,
        "GET",
        `Invoices/${seg((input as Record<string, unknown>).invoiceId)}`,
      )) as Record<string, unknown>;
      return data.Invoices;
    },
  });

  rl.registerAction("invoice.list", {
    access: "read",
    description: "List invoices",
    inputSchema: {
      limit: { type: "number", required: false },
      statuses: {
        type: "string",
        required: false,
        description: "Comma-separated statuses",
      },
      where: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.statuses) qs.statuses = p.statuses;
      if (p.where) qs.where = p.where;
      const data = (await api(ctx, "GET", "Invoices", undefined, qs)) as Record<
        string,
        unknown
      >;
      const invoices = data.Invoices as unknown[];
      return p.limit ? invoices.slice(0, p.limit as number) : invoices;
    },
  });

  rl.registerAction("invoice.update", {
    access: "write",
    description: "Update an invoice",
    inputSchema: {
      invoiceId: { type: "string", required: true },
      data: {
        type: "object",
        required: true,
        description: "Fields to update (Xero API format)",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const result = (await api(
        ctx,
        "POST",
        `Invoices/${seg(p.invoiceId)}`,
        p.data as Record<string, unknown>,
      )) as Record<string, unknown>;
      return result.Invoices;
    },
  });

  // ── Contact ─────────────────────────────────────────

  rl.registerAction("contact.create", {
    access: "write",
    description: "Create a contact",
    inputSchema: {
      Name: { type: "string", required: true },
      EmailAddress: { type: "string", required: false },
      FirstName: { type: "string", required: false },
      LastName: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { Contacts: [p] };
      const data = (await api(ctx, "POST", "Contacts", body)) as Record<
        string,
        unknown
      >;
      return data.Contacts;
    },
  });

  rl.registerAction("contact.get", {
    access: "read",
    description: "Get a contact by ID",
    inputSchema: { contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(
        ctx,
        "GET",
        `Contacts/${seg((input as Record<string, unknown>).contactId)}`,
      )) as Record<string, unknown>;
      return data.Contacts;
    },
  });

  rl.registerAction("contact.list", {
    access: "read",
    description: "List contacts",
    inputSchema: {
      limit: { type: "number", required: false },
      where: { type: "string", required: false },
      includeArchived: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.where) qs.where = p.where;
      if (p.includeArchived) qs.includeArchived = "true";
      const data = (await api(ctx, "GET", "Contacts", undefined, qs)) as Record<
        string,
        unknown
      >;
      const contacts = data.Contacts as unknown[];
      return p.limit ? contacts.slice(0, p.limit as number) : contacts;
    },
  });

  rl.registerAction("contact.update", {
    access: "write",
    description: "Update a contact",
    inputSchema: {
      contactId: { type: "string", required: true },
      data: {
        type: "object",
        required: true,
        description: "Fields to update (Xero API format)",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { Contacts: [p.data] };
      const result = (await api(
        ctx,
        "POST",
        `Contacts/${seg(p.contactId)}`,
        body,
      )) as Record<string, unknown>;
      return result.Contacts;
    },
  });
}
