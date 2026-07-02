import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.intercom.io";

async function apiRequest(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  )
    opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok)
    throw new Error(`Intercom API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

export default function intercom(rl: RunlinePluginAPI) {
  rl.setName("intercom");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Intercom access token",
      env: "INTERCOM_ACCESS_TOKEN",
    },
  });

  const tok = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.accessToken as string;

  // ── Contact (unified leads + users in v2) ───────────

  rl.registerAction("contact.create", {
    access: "write",
    description: "Create a contact (lead or user)",
    inputSchema: {
      role: { type: "string", required: true, description: "lead or user" },
      email: { type: "string", required: false, description: "Email" },
      name: { type: "string", required: false, description: "Full name" },
      phone: { type: "string", required: false, description: "Phone" },
      externalId: {
        type: "string",
        required: false,
        description: "External ID (for users)",
      },
      customAttributes: {
        type: "object",
        required: false,
        description: "Custom attributes",
      },
    },
    async execute(input, ctx) {
      const { role, email, name, phone, externalId, customAttributes } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = { role };
      if (email) body.email = email;
      if (name) body.name = name;
      if (phone) body.phone = phone;
      if (externalId) body.external_id = externalId;
      if (customAttributes) body.custom_attributes = customAttributes;
      return apiRequest(tok(ctx), "POST", "/contacts", body);
    },
  });

  rl.registerAction("contact.get", {
    access: "read",
    description: "Get a contact by ID",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      return apiRequest(
        tok(ctx),
        "GET",
        `/contacts/${(input as { contactId: string }).contactId}`,
      );
    },
  });

  rl.registerAction("contact.list", {
    access: "read",
    description: "List contacts",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      startingAfter: {
        type: "string",
        required: false,
        description: "Pagination cursor",
      },
    },
    async execute(input, ctx) {
      const { limit, startingAfter } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.per_page = limit;
      if (startingAfter) qs.starting_after = startingAfter;
      return apiRequest(tok(ctx), "GET", "/contacts", undefined, qs);
    },
  });

  rl.registerAction("contact.update", {
    access: "write",
    description: "Update a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      email: { type: "string", required: false, description: "Email" },
      name: { type: "string", required: false, description: "Name" },
      phone: { type: "string", required: false, description: "Phone" },
      customAttributes: {
        type: "object",
        required: false,
        description: "Custom attributes",
      },
    },
    async execute(input, ctx) {
      const { contactId, email, name, phone, customAttributes } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (email) body.email = email;
      if (name) body.name = name;
      if (phone) body.phone = phone;
      if (customAttributes) body.custom_attributes = customAttributes;
      return apiRequest(tok(ctx), "PUT", `/contacts/${contactId}`, body);
    },
  });

  rl.registerAction("contact.delete", {
    access: "write",
    description: "Delete a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      return apiRequest(
        tok(ctx),
        "DELETE",
        `/contacts/${(input as { contactId: string }).contactId}`,
      );
    },
  });

  rl.registerAction("contact.search", {
    access: "read",
    description: "Search contacts",
    inputSchema: {
      query: {
        type: "object",
        required: true,
        description: "Search query object (Intercom search format)",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results per page",
      },
    },
    async execute(input, ctx) {
      const { query, limit } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { query };
      if (limit) body.pagination = { per_page: limit };
      return apiRequest(tok(ctx), "POST", "/contacts/search", body);
    },
  });

  // ── Company ─────────────────────────────────────────

  rl.registerAction("company.create", {
    access: "write",
    description: "Create or update a company",
    inputSchema: {
      companyId: {
        type: "string",
        required: true,
        description: "Company ID (your identifier)",
      },
      name: { type: "string", required: false, description: "Company name" },
      plan: { type: "string", required: false, description: "Plan name" },
      customAttributes: {
        type: "object",
        required: false,
        description: "Custom attributes",
      },
    },
    async execute(input, ctx) {
      const { companyId, name, plan, customAttributes } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { company_id: companyId };
      if (name) body.name = name;
      if (plan) body.plan = plan;
      if (customAttributes) body.custom_attributes = customAttributes;
      return apiRequest(tok(ctx), "POST", "/companies", body);
    },
  });

  rl.registerAction("company.get", {
    access: "read",
    description: "Get a company",
    inputSchema: {
      companyId: {
        type: "string",
        required: true,
        description: "Intercom company ID",
      },
    },
    async execute(input, ctx) {
      return apiRequest(
        tok(ctx),
        "GET",
        `/companies/${(input as { companyId: string }).companyId}`,
      );
    },
  });

  rl.registerAction("company.list", {
    access: "read",
    description: "List companies",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      page: { type: "number", required: false, description: "Page" },
    },
    async execute(input, ctx) {
      const { limit, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.per_page = limit;
      if (page) qs.page = page;
      return apiRequest(tok(ctx), "GET", "/companies", undefined, qs);
    },
  });

  rl.registerAction("company.listUsers", {
    access: "read",
    description: "List users of a company",
    inputSchema: {
      companyId: { type: "string", required: true, description: "Company ID" },
    },
    async execute(input, ctx) {
      return apiRequest(
        tok(ctx),
        "GET",
        `/companies/${(input as { companyId: string }).companyId}/contacts`,
      );
    },
  });
}
