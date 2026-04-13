import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.brevo.com";

async function apiRequest(
  apiKey: string,
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
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": apiKey,
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brevo API error ${res.status}: ${text}`);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") return { success: true };
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return { success: true };
}

function getKey(ctx: { connection: { config: Record<string, unknown> } }): string {
  return ctx.connection.config.apiKey as string;
}

export default function brevo(rl: RunlinePluginAPI) {
  rl.setName("brevo");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Brevo (Sendinblue) API key",
      env: "BREVO_API_KEY",
    },
  });

  // ── Contact ─────────────────────────────────────────

  rl.registerAction("contact.create", {
    description: "Create a contact",
    inputSchema: {
      email: { type: "string", required: true, description: "Contact email" },
      attributes: { type: "object", required: false, description: "Contact attributes as key-value pairs" },
      listIds: { type: "array", required: false, description: "Array of list IDs to add contact to" },
    },
    async execute(input, ctx) {
      const { email, attributes, listIds } = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = { email };
      if (attributes) body.attributes = attributes;
      if (listIds) body.listIds = listIds;
      return apiRequest(getKey(ctx), "POST", "/v3/contacts", body);
    },
  });

  rl.registerAction("contact.upsert", {
    description: "Create or update a contact",
    inputSchema: {
      email: { type: "string", required: true, description: "Contact email" },
      attributes: { type: "object", required: false, description: "Contact attributes" },
      listIds: { type: "array", required: false, description: "List IDs" },
    },
    async execute(input, ctx) {
      const { email, attributes, listIds } = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = { email, updateEnabled: true };
      if (attributes) body.attributes = attributes;
      if (listIds) body.listIds = listIds;
      return apiRequest(getKey(ctx), "POST", "/v3/contacts", body);
    },
  });

  rl.registerAction("contact.get", {
    description: "Get a contact by email or ID",
    inputSchema: {
      identifier: { type: "string", required: true, description: "Email or contact ID" },
    },
    async execute(input, ctx) {
      const { identifier } = input as { identifier: string };
      return apiRequest(getKey(ctx), "GET", `/v3/contacts/${encodeURIComponent(identifier)}`);
    },
  });

  rl.registerAction("contact.list", {
    description: "List contacts",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results (default: 50, max: 1000)" },
      offset: { type: "number", required: false, description: "Offset for pagination" },
      sort: { type: "string", required: false, description: "Sort order: asc or desc" },
      modifiedSince: { type: "string", required: false, description: "Filter by modification date (ISO 8601)" },
    },
    async execute(input, ctx) {
      const { limit, offset, sort, modifiedSince } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.limit = limit;
      if (offset) qs.offset = offset;
      if (sort) qs.sort = sort;
      if (modifiedSince) qs.modifiedSince = modifiedSince;
      const data = (await apiRequest(getKey(ctx), "GET", "/v3/contacts", undefined, qs)) as Record<string, unknown>;
      return data.contacts ?? [];
    },
  });

  rl.registerAction("contact.update", {
    description: "Update a contact",
    inputSchema: {
      identifier: { type: "string", required: true, description: "Email or contact ID" },
      attributes: { type: "object", required: false, description: "Attributes to update" },
      listIds: { type: "array", required: false, description: "List IDs to add" },
      unlinkListIds: { type: "array", required: false, description: "List IDs to remove" },
    },
    async execute(input, ctx) {
      const { identifier, attributes, listIds, unlinkListIds } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (attributes) body.attributes = attributes;
      if (listIds) body.listIds = listIds;
      if (unlinkListIds) body.unlinkListIds = unlinkListIds;
      await apiRequest(getKey(ctx), "PUT", `/v3/contacts/${encodeURIComponent(identifier as string)}`, body);
      return { success: true };
    },
  });

  rl.registerAction("contact.delete", {
    description: "Delete a contact",
    inputSchema: {
      identifier: { type: "string", required: true, description: "Email or contact ID" },
    },
    async execute(input, ctx) {
      const { identifier } = input as { identifier: string };
      await apiRequest(getKey(ctx), "DELETE", `/v3/contacts/${encodeURIComponent(identifier)}`);
      return { success: true };
    },
  });

  // ── Attribute ───────────────────────────────────────

  rl.registerAction("attribute.create", {
    description: "Create a contact attribute",
    inputSchema: {
      category: { type: "string", required: true, description: "Category: normal, transactional, category, calculated, global" },
      name: { type: "string", required: true, description: "Attribute name" },
      type: { type: "string", required: false, description: "Type (for normal): text, date, float, boolean" },
      value: { type: "string", required: false, description: "Value (for calculated/global)" },
      enumeration: { type: "array", required: false, description: "Array of {value, label} for category type" },
    },
    async execute(input, ctx) {
      const { category, name, type, value, enumeration } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (type) body.type = type;
      if (value) body.value = value;
      if (enumeration) body.enumeration = enumeration;
      await apiRequest(getKey(ctx), "POST", `/v3/contacts/attributes/${category}/${encodeURIComponent(name as string)}`, body);
      return { success: true };
    },
  });

  rl.registerAction("attribute.update", {
    description: "Update a contact attribute",
    inputSchema: {
      category: { type: "string", required: true, description: "Category: calculated, category, global" },
      name: { type: "string", required: true, description: "Attribute name" },
      value: { type: "string", required: false, description: "New value" },
      enumeration: { type: "array", required: false, description: "Array of {value, label}" },
    },
    async execute(input, ctx) {
      const { category, name, value, enumeration } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (value) body.value = value;
      if (enumeration) body.enumeration = enumeration;
      return apiRequest(getKey(ctx), "PUT", `/v3/contacts/attributes/${category}/${encodeURIComponent(name as string)}`, body);
    },
  });

  rl.registerAction("attribute.delete", {
    description: "Delete a contact attribute",
    inputSchema: {
      category: { type: "string", required: true, description: "Category" },
      name: { type: "string", required: true, description: "Attribute name" },
    },
    async execute(input, ctx) {
      const { category, name } = input as { category: string; name: string };
      await apiRequest(getKey(ctx), "DELETE", `/v3/contacts/attributes/${category}/${encodeURIComponent(name)}`);
      return { success: true };
    },
  });

  rl.registerAction("attribute.list", {
    description: "List all contact attributes",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await apiRequest(getKey(ctx), "GET", "/v3/contacts/attributes")) as Record<string, unknown>;
      const attrs = (data.attributes as unknown[]) ?? [];
      if (limit) return attrs.slice(0, limit);
      return attrs;
    },
  });

  // ── Email ───────────────────────────────────────────

  rl.registerAction("email.send", {
    description: "Send a transactional email",
    inputSchema: {
      sender: { type: "string", required: true, description: "Sender email address" },
      to: { type: "array", required: true, description: "Array of recipient emails (or {email, name} objects)" },
      subject: { type: "string", required: true, description: "Email subject" },
      htmlContent: { type: "string", required: false, description: "HTML body" },
      textContent: { type: "string", required: false, description: "Plain text body" },
      cc: { type: "array", required: false, description: "CC recipients" },
      bcc: { type: "array", required: false, description: "BCC recipients" },
      tags: { type: "array", required: false, description: "Email tags" },
    },
    async execute(input, ctx) {
      const { sender, to, subject, htmlContent, textContent, cc, bcc, tags } =
        input as Record<string, unknown>;

      const toList = (to as unknown[]).map((r) =>
        typeof r === "string" ? { email: r } : r,
      );
      const senderObj = typeof sender === "string" ? { email: sender } : sender;

      const body: Record<string, unknown> = {
        sender: senderObj,
        to: toList,
        subject,
      };
      if (htmlContent) body.htmlContent = htmlContent;
      if (textContent) body.textContent = textContent;
      if (cc) body.cc = (cc as unknown[]).map((r) => (typeof r === "string" ? { email: r } : r));
      if (bcc) body.bcc = (bcc as unknown[]).map((r) => (typeof r === "string" ? { email: r } : r));
      if (tags) body.tags = tags;

      return apiRequest(getKey(ctx), "POST", "/v3/smtp/email", body);
    },
  });

  rl.registerAction("email.sendTemplate", {
    description: "Send an email using a template",
    inputSchema: {
      templateId: { type: "number", required: true, description: "Template ID" },
      to: { type: "array", required: true, description: "Array of recipient emails (or {email, name} objects)" },
      params: { type: "object", required: false, description: "Template parameters as key-value pairs" },
      tags: { type: "array", required: false, description: "Email tags" },
    },
    async execute(input, ctx) {
      const { templateId, to, params, tags } = input as Record<string, unknown>;
      const toList = (to as unknown[]).map((r) =>
        typeof r === "string" ? { email: r } : r,
      );
      const body: Record<string, unknown> = { templateId, to: toList };
      if (params) body.params = params;
      if (tags) body.tags = tags;
      return apiRequest(getKey(ctx), "POST", "/v3/smtp/email", body);
    },
  });

  // ── Sender ──────────────────────────────────────────

  rl.registerAction("sender.create", {
    description: "Create a sender",
    inputSchema: {
      name: { type: "string", required: true, description: "Sender name" },
      email: { type: "string", required: true, description: "Sender email" },
    },
    async execute(input, ctx) {
      const { name, email } = input as { name: string; email: string };
      return apiRequest(getKey(ctx), "POST", "/v3/senders", { name, email });
    },
  });

  rl.registerAction("sender.delete", {
    description: "Delete a sender",
    inputSchema: {
      id: { type: "string", required: true, description: "Sender ID" },
    },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      await apiRequest(getKey(ctx), "DELETE", `/v3/senders/${id}`);
      return { success: true };
    },
  });

  rl.registerAction("sender.list", {
    description: "List all senders",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await apiRequest(getKey(ctx), "GET", "/v3/senders")) as Record<string, unknown>;
      const senders = (data.senders as unknown[]) ?? [];
      if (limit) return senders.slice(0, limit);
      return senders;
    },
  });
}
