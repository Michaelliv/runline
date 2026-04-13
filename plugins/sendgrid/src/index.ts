import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.sendgrid.com/v3";

async function apiRequest(
  apiKey: string, method: string, endpoint: string,
  body?: unknown, qs?: Record<string, unknown>,
): Promise<{ data: unknown; headers: Record<string, string> }> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok && res.status !== 202) throw new Error(`SendGrid error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { data: text ? JSON.parse(text) : {}, headers };
}

export default function sendgrid(rl: RunlinePluginAPI) {
  rl.setName("sendgrid");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "SendGrid API key", env: "SENDGRID_API_KEY" },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiKey as string;

  // ── Mail ────────────────────────────────────────────

  rl.registerAction("mail.send", {
    description: "Send an email via SendGrid",
    inputSchema: {
      to: { type: "string", required: true, description: "Recipient email(s), comma-separated" },
      from: { type: "string", required: true, description: "Sender email" },
      fromName: { type: "string", required: false },
      subject: { type: "string", required: true },
      contentType: { type: "string", required: false, description: "text/plain or text/html (default text/plain)" },
      content: { type: "string", required: true, description: "Email body" },
      cc: { type: "string", required: false, description: "CC emails, comma-separated" },
      bcc: { type: "string", required: false, description: "BCC emails, comma-separated" },
      replyTo: { type: "string", required: false },
      templateId: { type: "string", required: false, description: "Dynamic template ID (overrides subject/content)" },
      dynamicTemplateData: { type: "object", required: false, description: "Template variables" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const toList = (p.to as string).split(",").map(e => ({ email: e.trim() }));
      const personalization: Record<string, unknown> = { to: toList };
      const body: Record<string, unknown> = {
        personalizations: [personalization],
        from: { email: (p.from as string).trim(), name: p.fromName },
      };
      if (p.templateId) {
        body.template_id = p.templateId;
        if (p.dynamicTemplateData) personalization.dynamic_template_data = p.dynamicTemplateData;
      } else {
        personalization.subject = p.subject;
        body.content = [{ type: (p.contentType as string) ?? "text/plain", value: p.content }];
      }
      if (p.cc) personalization.cc = (p.cc as string).split(",").map(e => ({ email: e.trim() }));
      if (p.bcc) personalization.bcc = (p.bcc as string).split(",").map(e => ({ email: e.trim() }));
      if (p.replyTo) body.reply_to_list = (p.replyTo as string).split(",").map(e => ({ email: e.trim() }));
      const { headers } = await apiRequest(key(ctx), "POST", "/mail/send", body);
      return { messageId: headers["x-message-id"] ?? null };
    },
  });

  // ── Contact ─────────────────────────────────────────

  rl.registerAction("contact.get", {
    description: "Get a contact by ID or email",
    inputSchema: {
      contactId: { type: "string", required: false },
      email: { type: "string", required: false, description: "Email (searches if no contactId)" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      if (p.contactId) {
        const { data } = await apiRequest(key(ctx), "GET", `/marketing/contacts/${p.contactId}`);
        return data;
      }
      const { data } = await apiRequest(key(ctx), "POST", "/marketing/contacts/search", { query: `email LIKE '${p.email}'` });
      const result = (data as Record<string, unknown>).result as unknown[];
      return result?.[0];
    },
  });

  rl.registerAction("contact.list", {
    description: "List contacts (optionally with SGQL query)",
    inputSchema: {
      query: { type: "string", required: false, description: "SGQL query filter" },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      let endpoint = "/marketing/contacts";
      let method = "GET";
      const body: Record<string, unknown> = {};
      if (p.query) { endpoint = "/marketing/contacts/search"; method = "POST"; body.query = p.query; }
      const { data } = await apiRequest(key(ctx), method, endpoint, Object.keys(body).length ? body : undefined);
      let result = ((data as Record<string, unknown>).result ?? []) as unknown[];
      if (p.limit) result = result.slice(0, p.limit as number);
      return result;
    },
  });

  rl.registerAction("contact.upsert", {
    description: "Create or update contacts",
    inputSchema: {
      contacts: { type: "object", required: true, description: "Array of contact objects [{email, first_name?, last_name?, ...}]" },
      listIds: { type: "object", required: false, description: "Array of list IDs to add contacts to" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { contacts: p.contacts };
      if (p.listIds) body.list_ids = p.listIds;
      const { data } = await apiRequest(key(ctx), "PUT", "/marketing/contacts", body);
      return data;
    },
  });

  rl.registerAction("contact.delete", {
    description: "Delete contacts by IDs",
    inputSchema: {
      ids: { type: "string", required: true, description: "Comma-separated contact IDs" },
    },
    async execute(input, ctx) {
      const { ids } = input as Record<string, unknown>;
      const { data } = await apiRequest(key(ctx), "DELETE", "/marketing/contacts", undefined, { ids });
      return data;
    },
  });

  // ── List ────────────────────────────────────────────

  rl.registerAction("list.create", {
    description: "Create a contact list",
    inputSchema: { name: { type: "string", required: true } },
    async execute(input, ctx) {
      const { data } = await apiRequest(key(ctx), "POST", "/marketing/lists", { name: (input as Record<string, unknown>).name });
      return data;
    },
  });

  rl.registerAction("list.get", {
    description: "Get a list by ID",
    inputSchema: { listId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { data } = await apiRequest(key(ctx), "GET", `/marketing/lists/${(input as Record<string, unknown>).listId}`);
      return data;
    },
  });

  rl.registerAction("list.list", {
    description: "List all contact lists",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const { data } = await apiRequest(key(ctx), "GET", "/marketing/lists");
      let result = ((data as Record<string, unknown>).result ?? []) as unknown[];
      if ((input as Record<string, unknown>)?.limit) result = result.slice(0, (input as Record<string, unknown>).limit as number);
      return result;
    },
  });

  rl.registerAction("list.update", {
    description: "Update a list name",
    inputSchema: { listId: { type: "string", required: true }, name: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const { data } = await apiRequest(key(ctx), "PATCH", `/marketing/lists/${p.listId}`, { name: p.name });
      return data;
    },
  });

  rl.registerAction("list.delete", {
    description: "Delete a list",
    inputSchema: {
      listId: { type: "string", required: true },
      deleteContacts: { type: "boolean", required: false, description: "Also delete contacts in list" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await apiRequest(key(ctx), "DELETE", `/marketing/lists/${p.listId}`, undefined, { delete_contacts: p.deleteContacts ? "true" : "false" });
      return { success: true };
    },
  });
}
