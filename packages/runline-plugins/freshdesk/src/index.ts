import type { RunlinePluginAPI } from "runline";

const STATUS: Record<string, number> = {
  open: 2,
  pending: 3,
  resolved: 4,
  closed: 5,
};
const PRIORITY: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};
const SOURCE: Record<string, number> = {
  email: 1,
  portal: 2,
  phone: 3,
  chat: 7,
  mobihelp: 8,
  feedbackWidget: 9,
  outboundEmail: 10,
};

async function apiRequest(
  domain: string,
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`https://${domain}.freshdesk.com/api/v2${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:X`)}`,
      "Content-Type": "application/json",
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  ) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok)
    throw new Error(`Freshdesk API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    domain: ctx.connection.config.domain as string,
    apiKey: ctx.connection.config.apiKey as string,
  };
}

function req(
  ctx: { connection: { config: Record<string, unknown> } },
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
) {
  const { domain, apiKey } = getConn(ctx);
  return apiRequest(domain, apiKey, method, endpoint, body, qs);
}

export default function freshdesk(rl: RunlinePluginAPI) {
  rl.setName("freshdesk");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    domain: {
      type: "string",
      required: true,
      description:
        "Freshdesk subdomain (e.g. 'mycompany' for mycompany.freshdesk.com)",
      env: "FRESHDESK_DOMAIN",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "Freshdesk API key",
      env: "FRESHDESK_API_KEY",
    },
  });

  // ── Ticket ──────────────────────────────────────────

  rl.registerAction("ticket.create", {
    access: "write",
    description: "Create a ticket",
    inputSchema: {
      email: {
        type: "string",
        required: false,
        description: "Requester email",
      },
      requesterId: {
        type: "number",
        required: false,
        description: "Requester user ID",
      },
      phone: {
        type: "string",
        required: false,
        description: "Requester phone",
      },
      subject: {
        type: "string",
        required: false,
        description: "Ticket subject",
      },
      description: {
        type: "string",
        required: false,
        description: "Ticket description (HTML)",
      },
      status: {
        type: "string",
        required: true,
        description: "open, pending, resolved, closed",
      },
      priority: {
        type: "string",
        required: true,
        description: "low, medium, high, urgent",
      },
      source: {
        type: "string",
        required: false,
        description:
          "email, portal, phone, chat, feedbackWidget, mobihelp, outboundEmail",
      },
      type: {
        type: "string",
        required: false,
        description: "Question, Incident, Problem, Feature Request, Refund",
      },
      responderId: { type: "number", required: false, description: "Agent ID" },
      groupId: { type: "number", required: false, description: "Group ID" },
      productId: { type: "number", required: false, description: "Product ID" },
      companyId: { type: "number", required: false, description: "Company ID" },
      tags: { type: "array", required: false, description: "Tags" },
      ccEmails: {
        type: "array",
        required: false,
        description: "CC email addresses",
      },
      dueBy: {
        type: "string",
        required: false,
        description: "Due date (ISO 8601)",
      },
      frDueBy: {
        type: "string",
        required: false,
        description: "First response due date",
      },
      customFields: {
        type: "object",
        required: false,
        description: "Custom fields as key-value pairs",
      },
    },
    async execute(input, ctx) {
      const i = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        status: STATUS[i.status as string] ?? 3,
        priority: PRIORITY[i.priority as string] ?? 1,
      };
      if (i.email) body.email = i.email;
      if (i.requesterId) body.requester_id = i.requesterId;
      if (i.phone) body.phone = i.phone;
      if (i.subject) body.subject = i.subject;
      if (i.description) body.description = i.description;
      if (i.source) body.source = SOURCE[i.source as string] ?? 2;
      if (i.type) body.type = i.type;
      if (i.responderId) body.responder_id = i.responderId;
      if (i.groupId) body.group_id = i.groupId;
      if (i.productId) body.product_id = i.productId;
      if (i.companyId) body.company_id = i.companyId;
      if (i.tags) body.tags = i.tags;
      if (i.ccEmails) body.cc_emails = i.ccEmails;
      if (i.dueBy) body.due_by = i.dueBy;
      if (i.frDueBy) body.fr_due_by = i.frDueBy;
      if (i.customFields) body.custom_fields = i.customFields;
      return req(ctx, "POST", "/tickets", body);
    },
  });

  rl.registerAction("ticket.get", {
    access: "read",
    description: "Get a ticket by ID",
    inputSchema: {
      ticketId: { type: "string", required: true, description: "Ticket ID" },
    },
    async execute(input, ctx) {
      return req(
        ctx,
        "GET",
        `/tickets/${(input as { ticketId: string }).ticketId}`,
      );
    },
  });

  rl.registerAction("ticket.list", {
    access: "read",
    description: "List tickets",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results (default: 30)",
      },
      requesterId: {
        type: "string",
        required: false,
        description: "Filter by requester ID",
      },
      requesterEmail: {
        type: "string",
        required: false,
        description: "Filter by requester email",
      },
      companyId: {
        type: "string",
        required: false,
        description: "Filter by company ID",
      },
      updatedSince: {
        type: "string",
        required: false,
        description: "Filter by updated since (ISO 8601)",
      },
      orderBy: {
        type: "string",
        required: false,
        description: "created_at, due_by, updated_at",
      },
      orderType: {
        type: "string",
        required: false,
        description: "asc or desc",
      },
      include: {
        type: "string",
        required: false,
        description: "Comma-separated: requester, company, stats, description",
      },
    },
    async execute(input, ctx) {
      const {
        limit,
        requesterId,
        requesterEmail,
        companyId,
        updatedSince,
        orderBy,
        orderType,
        include,
      } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.per_page = limit;
      if (requesterId) qs.requester_id = requesterId;
      if (requesterEmail) qs.email = requesterEmail;
      if (companyId) qs.company_id = companyId;
      if (updatedSince) qs.updated_since = updatedSince;
      if (orderBy) qs.order_by = orderBy;
      if (orderType) qs.order_type = orderType;
      if (include) qs.include = include;
      return req(ctx, "GET", "/tickets", undefined, qs);
    },
  });

  rl.registerAction("ticket.update", {
    access: "write",
    description: "Update a ticket",
    inputSchema: {
      ticketId: { type: "string", required: true, description: "Ticket ID" },
      status: {
        type: "string",
        required: false,
        description: "open, pending, resolved, closed",
      },
      priority: {
        type: "string",
        required: false,
        description: "low, medium, high, urgent",
      },
      source: { type: "string", required: false, description: "Source" },
      type: { type: "string", required: false, description: "Ticket type" },
      responderId: { type: "number", required: false, description: "Agent ID" },
      groupId: { type: "number", required: false, description: "Group ID" },
      productId: { type: "number", required: false, description: "Product ID" },
      companyId: { type: "number", required: false, description: "Company ID" },
      tags: { type: "array", required: false, description: "Tags" },
      dueBy: { type: "string", required: false, description: "Due date" },
      frDueBy: {
        type: "string",
        required: false,
        description: "First response due",
      },
      customFields: {
        type: "object",
        required: false,
        description: "Custom fields",
      },
    },
    async execute(input, ctx) {
      const {
        ticketId,
        status,
        priority,
        source,
        type,
        responderId,
        groupId,
        productId,
        companyId,
        tags,
        dueBy,
        frDueBy,
        customFields,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (status) body.status = STATUS[status as string];
      if (priority) body.priority = PRIORITY[priority as string];
      if (source) body.source = SOURCE[source as string];
      if (type) body.type = type;
      if (responderId) body.responder_id = responderId;
      if (groupId) body.group_id = groupId;
      if (productId) body.product_id = productId;
      if (companyId) body.company_id = companyId;
      if (tags) body.tags = tags;
      if (dueBy) body.due_by = dueBy;
      if (frDueBy) body.fr_due_by = frDueBy;
      if (customFields) body.custom_fields = customFields;
      return req(ctx, "PUT", `/tickets/${ticketId}`, body);
    },
  });

  rl.registerAction("ticket.delete", {
    access: "write",
    description: "Delete a ticket",
    inputSchema: {
      ticketId: { type: "string", required: true, description: "Ticket ID" },
    },
    async execute(input, ctx) {
      await req(
        ctx,
        "DELETE",
        `/tickets/${(input as { ticketId: string }).ticketId}`,
      );
      return { success: true };
    },
  });

  // ── Contact ─────────────────────────────────────────

  rl.registerAction("contact.create", {
    access: "write",
    description: "Create a contact",
    inputSchema: {
      name: { type: "string", required: true, description: "Full name" },
      email: { type: "string", required: false, description: "Email address" },
      phone: { type: "string", required: false, description: "Phone number" },
      mobile: { type: "string", required: false, description: "Mobile number" },
      address: { type: "string", required: false, description: "Address" },
      description: {
        type: "string",
        required: false,
        description: "Description",
      },
      jobTitle: { type: "string", required: false, description: "Job title" },
      tags: { type: "array", required: false, description: "Tags" },
      companyId: { type: "number", required: false, description: "Company ID" },
      customFields: {
        type: "object",
        required: false,
        description: "Custom fields",
      },
    },
    async execute(input, ctx) {
      const {
        name,
        email,
        phone,
        mobile,
        address,
        description: desc,
        jobTitle,
        tags,
        companyId,
        customFields,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name };
      if (email) body.email = email;
      if (phone) body.phone = phone;
      if (mobile) body.mobile = mobile;
      if (address) body.address = address;
      if (desc) body.description = desc;
      if (jobTitle) body.job_title = jobTitle;
      if (tags) body.tags = tags;
      if (companyId) body.company_id = companyId;
      if (customFields) body.custom_fields = customFields;
      return req(ctx, "POST", "/contacts", body);
    },
  });

  rl.registerAction("contact.get", {
    access: "read",
    description: "Get a contact by ID",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      return req(
        ctx,
        "GET",
        `/contacts/${(input as { contactId: string }).contactId}`,
      );
    },
  });

  rl.registerAction("contact.list", {
    access: "read",
    description: "List contacts",
    inputSchema: {
      email: {
        type: "string",
        required: false,
        description: "Filter by email",
      },
      phone: {
        type: "string",
        required: false,
        description: "Filter by phone",
      },
      mobile: {
        type: "string",
        required: false,
        description: "Filter by mobile",
      },
      companyId: {
        type: "string",
        required: false,
        description: "Filter by company ID",
      },
      state: {
        type: "string",
        required: false,
        description: "verified, unverified, blocked, deleted",
      },
    },
    async execute(input, ctx) {
      const { email, phone, mobile, companyId, state } = (input ??
        {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (email) qs.email = email;
      if (phone) qs.phone = phone;
      if (mobile) qs.mobile = mobile;
      if (companyId) qs.company_id = companyId;
      if (state) qs.state = state;
      return req(ctx, "GET", "/contacts", undefined, qs);
    },
  });

  rl.registerAction("contact.update", {
    access: "write",
    description: "Update a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      name: { type: "string", required: false, description: "Name" },
      email: { type: "string", required: false, description: "Email" },
      phone: { type: "string", required: false, description: "Phone" },
      mobile: { type: "string", required: false, description: "Mobile" },
      address: { type: "string", required: false, description: "Address" },
      jobTitle: { type: "string", required: false, description: "Job title" },
      tags: { type: "array", required: false, description: "Tags" },
      customFields: {
        type: "object",
        required: false,
        description: "Custom fields",
      },
    },
    async execute(input, ctx) {
      const {
        contactId,
        name,
        email,
        phone,
        mobile,
        address,
        jobTitle,
        tags,
        customFields,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (email) body.email = email;
      if (phone) body.phone = phone;
      if (mobile) body.mobile = mobile;
      if (address) body.address = address;
      if (jobTitle) body.job_title = jobTitle;
      if (tags) body.tags = tags;
      if (customFields) body.custom_fields = customFields;
      return req(ctx, "PUT", `/contacts/${contactId}`, body);
    },
  });

  rl.registerAction("contact.delete", {
    access: "write",
    description: "Delete a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      await req(
        ctx,
        "DELETE",
        `/contacts/${(input as { contactId: string }).contactId}`,
      );
      return { success: true };
    },
  });
}
