import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialRequest, pathSegment } from "../../_shared/credentials.js";
import { helpscoutCredential } from "./credentials.js";

async function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const res = await credentialRequest(ctx, helpscoutCredential, {
    target: "api",
    path: endpoint,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
  // Failures are reported by status alone: provider text can echo request data.
  if (!res.ok)
    throw new Error(`helpscout: request failed (HTTP ${res.status})`);
  if (res.status === 201 || res.status === 204)
    return { success: true, location: res.headers.get("Location") };
  return res.json();
}

function unwrapEmbedded(data: unknown, key: string): unknown {
  if (
    data &&
    typeof data === "object" &&
    "_embedded" in (data as Record<string, unknown>)
  ) {
    return (
      (data as Record<string, unknown>)._embedded as Record<string, unknown>
    )[key];
  }
  return data;
}

export default function helpscout(rl: RunlinePluginAPI) {
  rl.setName("helpscout");
  rl.setVersion("0.1.0");
  rl.setCredential(helpscoutCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "HelpScout OAuth2 access token",
      env: "HELPSCOUT_ACCESS_TOKEN",
    },
  });

  // ── Conversation ────────────────────────────────────

  rl.registerAction("conversation.create", {
    access: "write",
    description: "Create a conversation",
    inputSchema: {
      subject: { type: "string", required: true, description: "Subject" },
      customer: {
        type: "object",
        required: true,
        description: "{email} or {id}",
      },
      mailboxId: { type: "number", required: true, description: "Mailbox ID" },
      type: {
        type: "string",
        required: true,
        description: "email, phone, chat",
      },
      threads: {
        type: "array",
        required: true,
        description: "Array of thread objects [{type, text}]",
      },
      status: {
        type: "string",
        required: false,
        description: "active, pending, closed, spam",
      },
      tags: { type: "array", required: false, description: "Tag names" },
    },
    async execute(input, ctx) {
      const { subject, customer, mailboxId, type, threads, status, tags } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        subject,
        customer,
        mailboxId,
        type,
        threads,
      };
      if (status) body.status = status;
      if (tags) body.tags = tags;
      return apiRequest(ctx, "POST", "conversations", body);
    },
  });

  rl.registerAction("conversation.get", {
    access: "read",
    description: "Get a conversation",
    inputSchema: {
      conversationId: {
        type: "number",
        required: true,
        description: "Conversation ID",
      },
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `conversations/${pathSegment((input as { conversationId: number }).conversationId)}`,
      );
    },
  });

  rl.registerAction("conversation.list", {
    access: "read",
    description: "List conversations",
    inputSchema: {
      mailboxId: {
        type: "number",
        required: false,
        description: "Filter by mailbox",
      },
      status: {
        type: "string",
        required: false,
        description: "active, pending, closed, spam, all",
      },
      limit: { type: "number", required: false, description: "Max results" },
      page: { type: "number", required: false, description: "Page" },
    },
    async execute(input, ctx) {
      const { mailboxId, status, limit, page } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (mailboxId) qs.mailbox = mailboxId;
      if (status) qs.status = status;
      if (limit) qs.pageSize = limit;
      if (page) qs.page = page;
      return unwrapEmbedded(
        await apiRequest(ctx, "GET", "conversations", undefined, qs),
        "conversations",
      );
    },
  });

  rl.registerAction("conversation.delete", {
    access: "write",
    description: "Delete a conversation",
    inputSchema: {
      conversationId: {
        type: "number",
        required: true,
        description: "Conversation ID",
      },
    },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `conversations/${pathSegment((input as { conversationId: number }).conversationId)}`,
      );
      return { success: true };
    },
  });

  // ── Customer ────────────────────────────────────────

  rl.registerAction("customer.create", {
    access: "write",
    description: "Create a customer",
    inputSchema: {
      firstName: { type: "string", required: true, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      emails: {
        type: "array",
        required: false,
        description: "Array of {type, value} email objects",
      },
      phones: { type: "array", required: false, description: "Phone objects" },
    },
    async execute(input, ctx) {
      const { firstName, lastName, emails, phones } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { firstName };
      if (lastName) body.lastName = lastName;
      if (emails) body.emails = emails;
      if (phones) body.phones = phones;
      return apiRequest(ctx, "POST", "customers", body);
    },
  });

  rl.registerAction("customer.get", {
    access: "read",
    description: "Get a customer",
    inputSchema: {
      customerId: {
        type: "number",
        required: true,
        description: "Customer ID",
      },
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `customers/${pathSegment((input as { customerId: number }).customerId)}`,
      );
    },
  });

  rl.registerAction("customer.list", {
    access: "read",
    description: "List customers",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      page: { type: "number", required: false, description: "Page" },
    },
    async execute(input, ctx) {
      const { limit, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.pageSize = limit;
      if (page) qs.page = page;
      return unwrapEmbedded(
        await apiRequest(ctx, "GET", "customers", undefined, qs),
        "customers",
      );
    },
  });

  rl.registerAction("customer.update", {
    access: "write",
    description: "Update a customer",
    inputSchema: {
      customerId: {
        type: "number",
        required: true,
        description: "Customer ID",
      },
      properties: {
        type: "object",
        required: true,
        description: "Fields to update",
      },
    },
    async execute(input, ctx) {
      const { customerId, properties } = input as {
        customerId: number;
        properties: Record<string, unknown>;
      };
      return apiRequest(
        ctx,
        "PUT",
        `customers/${pathSegment(customerId)}`,
        properties,
      );
    },
  });

  rl.registerAction("customer.getProperties", {
    access: "read",
    description: "Get custom properties for a customer",
    inputSchema: {
      customerId: {
        type: "number",
        required: true,
        description: "Customer ID",
      },
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `customers/${pathSegment((input as { customerId: number }).customerId)}/properties`,
      );
    },
  });

  // ── Mailbox ─────────────────────────────────────────

  rl.registerAction("mailbox.get", {
    access: "read",
    description: "Get a mailbox",
    inputSchema: {
      mailboxId: { type: "number", required: true, description: "Mailbox ID" },
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `mailboxes/${pathSegment((input as { mailboxId: number }).mailboxId)}`,
      );
    },
  });

  rl.registerAction("mailbox.list", {
    access: "read",
    description: "List mailboxes",
    async execute(_input, ctx) {
      return unwrapEmbedded(
        await apiRequest(ctx, "GET", "mailboxes"),
        "mailboxes",
      );
    },
  });

  // ── Thread ──────────────────────────────────────────

  rl.registerAction("thread.create", {
    access: "write",
    description: "Create a thread (reply/note) on a conversation",
    inputSchema: {
      conversationId: {
        type: "number",
        required: true,
        description: "Conversation ID",
      },
      type: {
        type: "string",
        required: true,
        description: "reply, note, phone, chat",
      },
      text: {
        type: "string",
        required: true,
        description: "Thread body (HTML)",
      },
      customer: {
        type: "object",
        required: false,
        description: "Customer {email} or {id}",
      },
    },
    async execute(input, ctx) {
      const { conversationId, type, text, customer } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { type, text };
      if (customer) body.customer = customer;
      return apiRequest(
        ctx,
        "POST",
        `conversations/${pathSegment(conversationId)}/reply`,
        body,
      );
    },
  });

  rl.registerAction("thread.list", {
    access: "read",
    description: "List threads in a conversation",
    inputSchema: {
      conversationId: {
        type: "number",
        required: true,
        description: "Conversation ID",
      },
    },
    async execute(input, ctx) {
      return unwrapEmbedded(
        await apiRequest(
          ctx,
          "GET",
          `conversations/${pathSegment((input as { conversationId: number }).conversationId)}/threads`,
        ),
        "threads",
      );
    },
  });
}
