import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.infusionsoft.com/crm/rest/v1";

async function apiRequest(
  token: string, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const opts: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Keap API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

export default function keap(rl: RunlinePluginAPI) {
  rl.setName("keap");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "Keap OAuth2 access token", env: "KEAP_ACCESS_TOKEN" },
  });

  const tok = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.accessToken as string;

  // ── Company ─────────────────────────────────────────
  rl.registerAction("company.create", {
    description: "Create a company", inputSchema: { properties: { type: "object", required: true, description: "Company data (company_name required)" } },
    async execute(input, ctx) { return apiRequest(tok(ctx), "POST", "/companies", (input as { properties: Record<string, unknown> }).properties); },
  });
  rl.registerAction("company.list", {
    description: "List companies", inputSchema: { limit: { type: "number", required: false }, offset: { type: "number", required: false } },
    async execute(input, ctx) { const { limit, offset } = (input ?? {}) as Record<string, unknown>; const qs: Record<string, unknown> = {}; if (limit) qs.limit = limit; if (offset) qs.offset = offset; return apiRequest(tok(ctx), "GET", "/companies", undefined, qs); },
  });

  // ── Contact ─────────────────────────────────────────
  rl.registerAction("contact.upsert", {
    description: "Create or update a contact",
    inputSchema: {
      email: { type: "string", required: true, description: "Email" },
      givenName: { type: "string", required: false, description: "First name" },
      familyName: { type: "string", required: false, description: "Last name" },
      phone: { type: "string", required: false, description: "Phone" },
      properties: { type: "object", required: false, description: "Additional fields" },
    },
    async execute(input, ctx) {
      const { email, givenName, familyName, phone, properties } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { email_addresses: [{ email, field: "EMAIL1" }], duplicate_option: "Email" };
      if (givenName) body.given_name = givenName;
      if (familyName) body.family_name = familyName;
      if (phone) body.phone_numbers = [{ number: phone, field: "PHONE1" }];
      if (properties) Object.assign(body, properties);
      return apiRequest(tok(ctx), "PUT", "/contacts", body);
    },
  });
  rl.registerAction("contact.get", {
    description: "Get a contact", inputSchema: { contactId: { type: "number", required: true } },
    async execute(input, ctx) { return apiRequest(tok(ctx), "GET", `/contacts/${(input as { contactId: number }).contactId}`); },
  });
  rl.registerAction("contact.list", {
    description: "List contacts", inputSchema: { limit: { type: "number", required: false }, offset: { type: "number", required: false }, email: { type: "string", required: false, description: "Filter by email" } },
    async execute(input, ctx) { const { limit, offset, email } = (input ?? {}) as Record<string, unknown>; const qs: Record<string, unknown> = {}; if (limit) qs.limit = limit; if (offset) qs.offset = offset; if (email) qs.email = email; return apiRequest(tok(ctx), "GET", "/contacts", undefined, qs); },
  });
  rl.registerAction("contact.delete", {
    description: "Delete a contact", inputSchema: { contactId: { type: "number", required: true } },
    async execute(input, ctx) { await apiRequest(tok(ctx), "DELETE", `/contacts/${(input as { contactId: number }).contactId}`); return { success: true }; },
  });

  // ── Contact Note ────────────────────────────────────
  rl.registerAction("contactNote.create", {
    description: "Create a note on a contact",
    inputSchema: { contactId: { type: "number", required: true }, title: { type: "string", required: true }, body: { type: "string", required: false }, type: { type: "string", required: false, description: "Appointment, Call, Email, Fax, Letter, Other" } },
    async execute(input, ctx) {
      const { contactId, title, body: noteBody, type } = input as Record<string, unknown>;
      const b: Record<string, unknown> = { contact_id: contactId, title };
      if (noteBody) b.body = noteBody;
      if (type) b.type = type;
      return apiRequest(tok(ctx), "POST", `/contacts/${contactId}/notes`, b);
    },
  });
  rl.registerAction("contactNote.get", {
    description: "Get a note", inputSchema: { noteId: { type: "number", required: true } },
    async execute(input, ctx) { return apiRequest(tok(ctx), "GET", `/notes/${(input as { noteId: number }).noteId}`); },
  });
  rl.registerAction("contactNote.list", {
    description: "List notes for a contact", inputSchema: { contactId: { type: "number", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) { const { contactId, limit } = input as Record<string, unknown>; const qs: Record<string, unknown> = {}; if (limit) qs.limit = limit; return apiRequest(tok(ctx), "GET", `/contacts/${contactId}/notes`, undefined, qs); },
  });
  rl.registerAction("contactNote.update", {
    description: "Update a note", inputSchema: { noteId: { type: "number", required: true }, title: { type: "string", required: false }, body: { type: "string", required: false } },
    async execute(input, ctx) { const { noteId, title, body: b } = input as Record<string, unknown>; const bd: Record<string, unknown> = {}; if (title) bd.title = title; if (b) bd.body = b; return apiRequest(tok(ctx), "PATCH", `/notes/${noteId}`, bd); },
  });
  rl.registerAction("contactNote.delete", {
    description: "Delete a note", inputSchema: { noteId: { type: "number", required: true } },
    async execute(input, ctx) { await apiRequest(tok(ctx), "DELETE", `/notes/${(input as { noteId: number }).noteId}`); return { success: true }; },
  });

  // ── Contact Tag ─────────────────────────────────────
  rl.registerAction("contactTag.add", {
    description: "Add a tag to a contact", inputSchema: { contactId: { type: "number", required: true }, tagId: { type: "number", required: true } },
    async execute(input, ctx) { const { contactId, tagId } = input as Record<string, unknown>; return apiRequest(tok(ctx), "POST", `/contacts/${contactId}/tags`, { tagIds: [tagId] }); },
  });
  rl.registerAction("contactTag.remove", {
    description: "Remove a tag from a contact", inputSchema: { contactId: { type: "number", required: true }, tagId: { type: "number", required: true } },
    async execute(input, ctx) { const { contactId, tagId } = input as Record<string, unknown>; await apiRequest(tok(ctx), "DELETE", `/contacts/${contactId}/tags/${tagId}`); return { success: true }; },
  });
  rl.registerAction("contactTag.list", {
    description: "List tags on a contact", inputSchema: { contactId: { type: "number", required: true } },
    async execute(input, ctx) { return apiRequest(tok(ctx), "GET", `/contacts/${(input as { contactId: number }).contactId}/tags`); },
  });

  // ── E-commerce Order ────────────────────────────────
  rl.registerAction("order.create", {
    description: "Create an order", inputSchema: { properties: { type: "object", required: true, description: "Order data (contact_id, order_items required)" } },
    async execute(input, ctx) { return apiRequest(tok(ctx), "POST", "/orders", (input as { properties: Record<string, unknown> }).properties); },
  });
  rl.registerAction("order.get", {
    description: "Get an order", inputSchema: { orderId: { type: "number", required: true } },
    async execute(input, ctx) { return apiRequest(tok(ctx), "GET", `/orders/${(input as { orderId: number }).orderId}`); },
  });
  rl.registerAction("order.list", {
    description: "List orders", inputSchema: { limit: { type: "number", required: false }, offset: { type: "number", required: false }, contactId: { type: "number", required: false } },
    async execute(input, ctx) { const { limit, offset, contactId } = (input ?? {}) as Record<string, unknown>; const qs: Record<string, unknown> = {}; if (limit) qs.limit = limit; if (offset) qs.offset = offset; if (contactId) qs.contact_id = contactId; return apiRequest(tok(ctx), "GET", "/orders", undefined, qs); },
  });
  rl.registerAction("order.delete", {
    description: "Delete an order", inputSchema: { orderId: { type: "number", required: true } },
    async execute(input, ctx) { await apiRequest(tok(ctx), "DELETE", `/orders/${(input as { orderId: number }).orderId}`); return { success: true }; },
  });

  // ── E-commerce Product ──────────────────────────────
  rl.registerAction("product.create", {
    description: "Create a product", inputSchema: { properties: { type: "object", required: true, description: "Product data (product_name, product_price required)" } },
    async execute(input, ctx) { return apiRequest(tok(ctx), "POST", "/products", (input as { properties: Record<string, unknown> }).properties); },
  });
  rl.registerAction("product.get", {
    description: "Get a product", inputSchema: { productId: { type: "number", required: true } },
    async execute(input, ctx) { return apiRequest(tok(ctx), "GET", `/products/${(input as { productId: number }).productId}`); },
  });
  rl.registerAction("product.list", {
    description: "List products", inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) { const qs: Record<string, unknown> = {}; if ((input as Record<string, unknown>)?.limit) qs.limit = (input as Record<string, unknown>).limit; return apiRequest(tok(ctx), "GET", "/products", undefined, qs); },
  });
  rl.registerAction("product.delete", {
    description: "Delete a product", inputSchema: { productId: { type: "number", required: true } },
    async execute(input, ctx) { await apiRequest(tok(ctx), "DELETE", `/products/${(input as { productId: number }).productId}`); return { success: true }; },
  });

  // ── Email ───────────────────────────────────────────
  rl.registerAction("email.send", {
    description: "Send an email to a contact",
    inputSchema: {
      contactId: { type: "number", required: true, description: "Contact ID" },
      subject: { type: "string", required: true },
      htmlContent: { type: "string", required: true, description: "HTML body" },
    },
    async execute(input, ctx) {
      const { contactId, subject, htmlContent } = input as Record<string, unknown>;
      return apiRequest(tok(ctx), "POST", "/emails/queue", { contacts: [contactId], subject, html_content: htmlContent });
    },
  });
  rl.registerAction("email.list", {
    description: "List emails for a contact", inputSchema: { contactId: { type: "number", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) { const { contactId, limit } = input as Record<string, unknown>; const qs: Record<string, unknown> = { contact_id: contactId }; if (limit) qs.limit = limit; return apiRequest(tok(ctx), "GET", "/emails", undefined, qs); },
  });
}
