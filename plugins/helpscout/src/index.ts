import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.helpscout.net/v2";

async function apiRequest(
  token: string, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const opts: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`HelpScout API error ${res.status}: ${await res.text()}`);
  if (res.status === 201 || res.status === 204) return { success: true, location: res.headers.get("Location") };
  return res.json();
}

function unwrapEmbedded(data: unknown, key: string): unknown {
  if (data && typeof data === "object" && "_embedded" in (data as Record<string, unknown>)) {
    return ((data as Record<string, unknown>)._embedded as Record<string, unknown>)[key];
  }
  return data;
}

export default function helpscout(rl: RunlinePluginAPI) {
  rl.setName("helpscout");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "HelpScout OAuth2 access token", env: "HELPSCOUT_ACCESS_TOKEN" },
  });

  const tok = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.accessToken as string;

  // ── Conversation ────────────────────────────────────

  rl.registerAction("conversation.create", {
    description: "Create a conversation",
    inputSchema: {
      subject: { type: "string", required: true, description: "Subject" },
      customer: { type: "object", required: true, description: "{email} or {id}" },
      mailboxId: { type: "number", required: true, description: "Mailbox ID" },
      type: { type: "string", required: true, description: "email, phone, chat" },
      threads: { type: "array", required: true, description: "Array of thread objects [{type, text}]" },
      status: { type: "string", required: false, description: "active, pending, closed, spam" },
      tags: { type: "array", required: false, description: "Tag names" },
    },
    async execute(input, ctx) {
      const { subject, customer, mailboxId, type, threads, status, tags } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { subject, customer, mailboxId, type, threads };
      if (status) body.status = status;
      if (tags) body.tags = tags;
      return apiRequest(tok(ctx), "POST", "/conversations", body);
    },
  });

  rl.registerAction("conversation.get", {
    description: "Get a conversation",
    inputSchema: { conversationId: { type: "number", required: true, description: "Conversation ID" } },
    async execute(input, ctx) { return apiRequest(tok(ctx), "GET", `/conversations/${(input as { conversationId: number }).conversationId}`); },
  });

  rl.registerAction("conversation.list", {
    description: "List conversations",
    inputSchema: {
      mailboxId: { type: "number", required: false, description: "Filter by mailbox" },
      status: { type: "string", required: false, description: "active, pending, closed, spam, all" },
      limit: { type: "number", required: false, description: "Max results" },
      page: { type: "number", required: false, description: "Page" },
    },
    async execute(input, ctx) {
      const { mailboxId, status, limit, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (mailboxId) qs.mailbox = mailboxId;
      if (status) qs.status = status;
      if (limit) qs.pageSize = limit;
      if (page) qs.page = page;
      return unwrapEmbedded(await apiRequest(tok(ctx), "GET", "/conversations", undefined, qs), "conversations");
    },
  });

  rl.registerAction("conversation.delete", {
    description: "Delete a conversation",
    inputSchema: { conversationId: { type: "number", required: true, description: "Conversation ID" } },
    async execute(input, ctx) { await apiRequest(tok(ctx), "DELETE", `/conversations/${(input as { conversationId: number }).conversationId}`); return { success: true }; },
  });

  // ── Customer ────────────────────────────────────────

  rl.registerAction("customer.create", {
    description: "Create a customer",
    inputSchema: {
      firstName: { type: "string", required: true, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      emails: { type: "array", required: false, description: "Array of {type, value} email objects" },
      phones: { type: "array", required: false, description: "Phone objects" },
    },
    async execute(input, ctx) {
      const { firstName, lastName, emails, phones } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { firstName };
      if (lastName) body.lastName = lastName;
      if (emails) body.emails = emails;
      if (phones) body.phones = phones;
      return apiRequest(tok(ctx), "POST", "/customers", body);
    },
  });

  rl.registerAction("customer.get", {
    description: "Get a customer",
    inputSchema: { customerId: { type: "number", required: true, description: "Customer ID" } },
    async execute(input, ctx) { return apiRequest(tok(ctx), "GET", `/customers/${(input as { customerId: number }).customerId}`); },
  });

  rl.registerAction("customer.list", {
    description: "List customers",
    inputSchema: { limit: { type: "number", required: false, description: "Max results" }, page: { type: "number", required: false, description: "Page" } },
    async execute(input, ctx) {
      const { limit, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.pageSize = limit;
      if (page) qs.page = page;
      return unwrapEmbedded(await apiRequest(tok(ctx), "GET", "/customers", undefined, qs), "customers");
    },
  });

  rl.registerAction("customer.update", {
    description: "Update a customer",
    inputSchema: {
      customerId: { type: "number", required: true, description: "Customer ID" },
      properties: { type: "object", required: true, description: "Fields to update" },
    },
    async execute(input, ctx) {
      const { customerId, properties } = input as { customerId: number; properties: Record<string, unknown> };
      return apiRequest(tok(ctx), "PUT", `/customers/${customerId}`, properties);
    },
  });

  rl.registerAction("customer.getProperties", {
    description: "Get custom properties for a customer",
    inputSchema: { customerId: { type: "number", required: true, description: "Customer ID" } },
    async execute(input, ctx) { return apiRequest(tok(ctx), "GET", `/customers/${(input as { customerId: number }).customerId}/properties`); },
  });

  // ── Mailbox ─────────────────────────────────────────

  rl.registerAction("mailbox.get", {
    description: "Get a mailbox",
    inputSchema: { mailboxId: { type: "number", required: true, description: "Mailbox ID" } },
    async execute(input, ctx) { return apiRequest(tok(ctx), "GET", `/mailboxes/${(input as { mailboxId: number }).mailboxId}`); },
  });

  rl.registerAction("mailbox.list", {
    description: "List mailboxes",
    async execute(_input, ctx) { return unwrapEmbedded(await apiRequest(tok(ctx), "GET", "/mailboxes"), "mailboxes"); },
  });

  // ── Thread ──────────────────────────────────────────

  rl.registerAction("thread.create", {
    description: "Create a thread (reply/note) on a conversation",
    inputSchema: {
      conversationId: { type: "number", required: true, description: "Conversation ID" },
      type: { type: "string", required: true, description: "reply, note, phone, chat" },
      text: { type: "string", required: true, description: "Thread body (HTML)" },
      customer: { type: "object", required: false, description: "Customer {email} or {id}" },
    },
    async execute(input, ctx) {
      const { conversationId, type, text, customer } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { type, text };
      if (customer) body.customer = customer;
      return apiRequest(tok(ctx), "POST", `/conversations/${conversationId}/reply`, body);
    },
  });

  rl.registerAction("thread.list", {
    description: "List threads in a conversation",
    inputSchema: { conversationId: { type: "number", required: true, description: "Conversation ID" } },
    async execute(input, ctx) {
      return unwrapEmbedded(await apiRequest(tok(ctx), "GET", `/conversations/${(input as { conversationId: number }).conversationId}/threads`), "threads");
    },
  });
}
