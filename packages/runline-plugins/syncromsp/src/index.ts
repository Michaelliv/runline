import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { syncromspCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

/** The transport appends the api_key query parameter when signing. */
function api(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, syncromspCredential, "syncromsp", {
    target: "api",
    path: endpoint,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

async function paginate(
  ctx: ActionContext,
  endpoint: string,
  key: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const results: unknown[] = [];
  let page = 1;
  let batch: unknown[];
  do {
    qs.page = page;
    const res = (await api(ctx, "GET", endpoint, undefined, qs)) as Record<
      string,
      unknown
    >;
    batch = (res[key] ?? []) as unknown[];
    results.push(...batch);
    page++;
  } while (batch.length > 0);
  return results;
}

export default function syncromsp(rl: RunlinePluginAPI) {
  rl.setName("syncromsp");
  rl.setVersion("0.1.0");
  rl.setCredential(syncromspCredential);
  rl.setConnectionSchema({
    subdomain: {
      type: "string",
      required: true,
      description: "SyncroMSP subdomain",
      env: "SYNCROMSP_SUBDOMAIN",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "API key",
      env: "SYNCROMSP_API_KEY",
    },
  });

  // ── Customer ────────────────────────────────────────

  rl.registerAction("customer.create", {
    access: "write",
    description: "Create a customer",
    inputSchema: {
      email: { type: "string", required: true },
      businessName: { type: "string", required: false },
      firstName: { type: "string", required: false },
      lastname: { type: "string", required: false },
      phone: { type: "string", required: false },
      notes: { type: "string", required: false },
      address: { type: "string", required: false },
      city: { type: "string", required: false },
      state: { type: "string", required: false },
      zip: { type: "string", required: false },
    },
    async execute(input, ctx) {
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
      const res = (await api(ctx, "POST", "customers", body)) as Record<
        string,
        unknown
      >;
      return res.customer ?? res;
    },
  });

  rl.registerAction("customer.get", {
    access: "read",
    description: "Get a customer",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const res = (await api(
        ctx,
        "GET",
        `customers/${seg((input as Record<string, unknown>).id)}`,
      )) as Record<string, unknown>;
      return res.customer ?? res;
    },
  });

  rl.registerAction("customer.list", {
    access: "read",
    description: "List customers",
    inputSchema: {
      limit: { type: "number", required: false },
      businessName: { type: "string", required: false },
      includeDisabled: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.businessName) qs.business_name = p.businessName;
      if (p.includeDisabled) qs.include_disabled = true;
      if (p.limit) {
        qs.per_page = p.limit;
        const res = (await api(
          ctx,
          "GET",
          "customers",
          undefined,
          qs,
        )) as Record<string, unknown>;
        return res.customers ?? res;
      }
      return paginate(ctx, "customers", "customers", qs);
    },
  });

  rl.registerAction("customer.update", {
    access: "write",
    description: "Update a customer",
    inputSchema: {
      id: { type: "string", required: true },
      email: { type: "string", required: false },
      businessName: { type: "string", required: false },
      firstName: { type: "string", required: false },
      lastname: { type: "string", required: false },
      phone: { type: "string", required: false },
      notes: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.email) body.email = fields.email;
      if (fields.businessName) body.business_name = fields.businessName;
      if (fields.firstName) body.firstname = fields.firstName;
      if (fields.lastname) body.lastname = fields.lastname;
      if (fields.phone) body.phone = fields.phone;
      if (fields.notes) body.notes = fields.notes;
      const res = (await api(
        ctx,
        "PUT",
        `customers/${seg(id)}`,
        body,
      )) as Record<string, unknown>;
      return res.customer ?? res;
    },
  });

  rl.registerAction("customer.delete", {
    access: "write",
    description: "Delete a customer",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `customers/${seg((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  // ── Contact ─────────────────────────────────────────

  rl.registerAction("contact.create", {
    access: "write",
    description: "Create a contact",
    inputSchema: {
      customerId: { type: "string", required: true },
      email: { type: "string", required: true },
      name: { type: "string", required: false },
      phone: { type: "string", required: false },
      notes: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        customer_id: p.customerId,
        email: p.email,
      };
      if (p.name) body.name = p.name;
      if (p.phone) body.phone = p.phone;
      if (p.notes) body.notes = p.notes;
      return api(ctx, "POST", "contacts", body);
    },
  });

  rl.registerAction("contact.get", {
    access: "read",
    description: "Get a contact",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `contacts/${seg((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction("contact.list", {
    access: "read",
    description: "List contacts",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      if (p.limit) {
        const res = (await api(ctx, "GET", "contacts")) as Record<
          string,
          unknown
        >;
        return ((res.contacts ?? []) as unknown[]).slice(0, p.limit as number);
      }
      return paginate(ctx, "contacts", "contacts");
    },
  });

  rl.registerAction("contact.update", {
    access: "write",
    description: "Update a contact",
    inputSchema: {
      id: { type: "string", required: true },
      customerId: { type: "string", required: false },
      email: { type: "string", required: false },
      name: { type: "string", required: false },
      phone: { type: "string", required: false },
      notes: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.customerId) body.customer_id = fields.customerId;
      if (fields.email) body.email = fields.email;
      if (fields.name) body.name = fields.name;
      if (fields.phone) body.phone = fields.phone;
      if (fields.notes) body.notes = fields.notes;
      return api(ctx, "PUT", `contacts/${seg(id)}`, body);
    },
  });

  rl.registerAction("contact.delete", {
    access: "write",
    description: "Delete a contact",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `contacts/${seg((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  // ── Ticket ──────────────────────────────────────────

  rl.registerAction("ticket.create", {
    access: "write",
    description: "Create a ticket",
    inputSchema: {
      customerId: { type: "string", required: true },
      subject: { type: "string", required: true },
      issueType: { type: "string", required: false },
      status: { type: "string", required: false },
      assetId: { type: "string", required: false },
      contactId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        customer_id: p.customerId,
        subject: p.subject,
      };
      if (p.issueType) body.problem_type = p.issueType;
      if (p.status) body.status = p.status;
      if (p.assetId) body.asset_id = p.assetId;
      if (p.contactId) body.contact_id = p.contactId;
      const res = (await api(ctx, "POST", "tickets", body)) as Record<
        string,
        unknown
      >;
      return res.ticket ?? res;
    },
  });

  rl.registerAction("ticket.get", {
    access: "read",
    description: "Get a ticket",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const res = (await api(
        ctx,
        "GET",
        `tickets/${seg((input as Record<string, unknown>).id)}`,
      )) as Record<string, unknown>;
      return res.ticket ?? res;
    },
  });

  rl.registerAction("ticket.list", {
    access: "read",
    description: "List tickets",
    inputSchema: {
      limit: { type: "number", required: false },
      status: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.status) qs.status = p.status;
      if (p.limit) {
        qs.per_page = p.limit;
        const res = (await api(ctx, "GET", "tickets", undefined, qs)) as Record<
          string,
          unknown
        >;
        return res.tickets ?? res;
      }
      return paginate(ctx, "tickets", "tickets", qs);
    },
  });

  rl.registerAction("ticket.update", {
    access: "write",
    description: "Update a ticket",
    inputSchema: {
      id: { type: "string", required: true },
      subject: { type: "string", required: false },
      status: { type: "string", required: false },
      issueType: { type: "string", required: false },
      customerId: { type: "string", required: false },
      assetId: { type: "string", required: false },
      dueDate: { type: "string", required: false },
      contactId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.subject) body.subject = fields.subject;
      if (fields.status) body.status = fields.status;
      if (fields.issueType) body.problem_type = fields.issueType;
      if (fields.customerId) body.customer_id = fields.customerId;
      if (fields.assetId) body.asset_id = fields.assetId;
      if (fields.dueDate) body.due_date = fields.dueDate;
      if (fields.contactId) body.contact_id = fields.contactId;
      const res = (await api(ctx, "PUT", `tickets/${seg(id)}`, body)) as Record<
        string,
        unknown
      >;
      return res.ticket ?? res;
    },
  });

  rl.registerAction("ticket.delete", {
    access: "write",
    description: "Delete a ticket",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `tickets/${seg((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  // ── RMM Alerts ──────────────────────────────────────

  rl.registerAction("rmmAlert.create", {
    access: "write",
    description: "Create an RMM alert",
    inputSchema: {
      customerId: { type: "string", required: true },
      assetId: { type: "string", required: true },
      description: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const res = (await api(ctx, "POST", "rmm_alerts", {
        customer_id: p.customerId,
        asset_id: p.assetId,
        description: p.description,
      })) as Record<string, unknown>;
      return res.alert ?? res;
    },
  });

  rl.registerAction("rmmAlert.get", {
    access: "read",
    description: "Get an RMM alert",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const res = (await api(
        ctx,
        "GET",
        `rmm_alerts/${seg((input as Record<string, unknown>).id)}`,
      )) as Record<string, unknown>;
      return res.rmm_alert ?? res;
    },
  });

  rl.registerAction("rmmAlert.list", {
    access: "read",
    description: "List RMM alerts",
    inputSchema: {
      limit: { type: "number", required: false },
      status: {
        type: "string",
        required: false,
        description: "all, active, or resolved",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { status: p.status ?? "all" };
      if (p.limit) {
        qs.per_page = p.limit;
        const res = (await api(
          ctx,
          "GET",
          "rmm_alerts",
          undefined,
          qs,
        )) as Record<string, unknown>;
        return res.rmm_alerts ?? res;
      }
      return paginate(ctx, "rmm_alerts", "rmm_alerts", qs);
    },
  });

  rl.registerAction("rmmAlert.delete", {
    access: "write",
    description: "Delete an RMM alert",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `rmm_alerts/${seg((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("rmmAlert.mute", {
    access: "write",
    description: "Mute an RMM alert",
    inputSchema: {
      id: { type: "string", required: true },
      muteFor: {
        type: "string",
        required: true,
        description: "Duration to mute, e.g. 1_hour, 1_day, forever",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(ctx, "POST", `rmm_alerts/${seg(p.id)}/mute`, {
        id: p.id,
        mute_for: p.muteFor,
      });
    },
  });
}
