import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { zendeskCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

/** One Zendesk call: every endpoint is a .json path beneath /api/v2/. */
function api(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, zendeskCredential, "zendesk", {
    target: "api",
    path: `${endpoint}.json`,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

export default function zendesk(rl: RunlinePluginAPI) {
  rl.setName("zendesk");
  rl.setVersion("0.1.0");
  rl.setCredential(zendeskCredential);
  rl.setConnectionSchema({
    subdomain: {
      type: "string",
      required: true,
      description: "Zendesk subdomain",
      env: "ZENDESK_SUBDOMAIN",
    },
    email: {
      type: "string",
      required: true,
      description: "Agent email",
      env: "ZENDESK_EMAIL",
    },
    apiToken: {
      type: "string",
      required: true,
      description: "Zendesk API token",
      env: "ZENDESK_API_TOKEN",
    },
  });

  // ── Ticket ──────────────────────────────────────────

  rl.registerAction("ticket.create", {
    access: "write",
    description: "Create a ticket",
    inputSchema: {
      description: { type: "string", required: true },
      subject: { type: "string", required: false },
      type: { type: "string", required: false },
      status: { type: "string", required: false },
      priority: { type: "string", required: false },
      tags: { type: "object", required: false },
      customFields: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const ticket: Record<string, unknown> = {
        comment: { body: p.description },
      };
      if (p.subject) ticket.subject = p.subject;
      if (p.type) ticket.type = p.type;
      if (p.status) ticket.status = p.status;
      if (p.priority) ticket.priority = p.priority;
      if (p.tags) ticket.tags = p.tags;
      if (p.customFields) ticket.custom_fields = p.customFields;
      const data = (await api(ctx, "POST", "tickets", {
        ticket,
      })) as Record<string, unknown>;
      return data.ticket;
    },
  });

  rl.registerAction("ticket.get", {
    access: "read",
    description: "Get a ticket",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(
        ctx,
        "GET",
        `tickets/${seg((input as Record<string, unknown>).id)}`,
      )) as Record<string, unknown>;
      return data.ticket;
    },
  });

  rl.registerAction("ticket.list", {
    access: "read",
    description: "Search tickets",
    inputSchema: {
      query: {
        type: "string",
        required: false,
        description: "Zendesk search query",
      },
      limit: { type: "number", required: false },
      status: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      let q = "type:ticket";
      if (p.query) q += ` ${p.query}`;
      if (p.status) q += ` status:${p.status}`;
      const qs: Record<string, unknown> = { query: q };
      if (p.limit) qs.per_page = p.limit;
      const data = (await api(ctx, "GET", "search", undefined, qs)) as Record<
        string,
        unknown
      >;
      return data.results;
    },
  });

  rl.registerAction("ticket.update", {
    access: "write",
    description: "Update a ticket",
    inputSchema: {
      id: { type: "string", required: true },
      data: {
        type: "object",
        required: true,
        description: "Ticket fields to update",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(ctx, "PUT", `tickets/${seg(p.id)}`, {
        ticket: p.data,
      })) as Record<string, unknown>;
      return data.ticket;
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

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.create", {
    access: "write",
    description: "Create a user",
    inputSchema: {
      name: { type: "string", required: true },
      email: { type: "string", required: false },
      role: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const data = (await api(ctx, "POST", "users", {
        user: input,
      })) as Record<string, unknown>;
      return data.user;
    },
  });

  rl.registerAction("user.get", {
    access: "read",
    description: "Get a user",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(
        ctx,
        "GET",
        `users/${seg((input as Record<string, unknown>).id)}`,
      )) as Record<string, unknown>;
      return data.user;
    },
  });

  rl.registerAction("user.list", {
    access: "read",
    description: "List users",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit)
        qs.per_page = (input as Record<string, unknown>).limit;
      const data = (await api(ctx, "GET", "users", undefined, qs)) as Record<
        string,
        unknown
      >;
      return data.users;
    },
  });

  rl.registerAction("user.update", {
    access: "write",
    description: "Update a user",
    inputSchema: {
      id: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(ctx, "PUT", `users/${seg(p.id)}`, {
        user: p.data,
      })) as Record<string, unknown>;
      return data.user;
    },
  });

  rl.registerAction("user.delete", {
    access: "write",
    description: "Delete a user",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(
        ctx,
        "DELETE",
        `users/${seg((input as Record<string, unknown>).id)}`,
      )) as Record<string, unknown>;
      return data.user;
    },
  });

  rl.registerAction("user.search", {
    access: "read",
    description: "Search users",
    inputSchema: {
      query: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { query: p.query };
      if (p.limit) qs.per_page = p.limit;
      const data = (await api(
        ctx,
        "GET",
        "users/search",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.users;
    },
  });

  // ── Organization ────────────────────────────────────

  rl.registerAction("organization.create", {
    access: "write",
    description: "Create an organization",
    inputSchema: { name: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(ctx, "POST", "organizations", {
        organization: input,
      })) as Record<string, unknown>;
      return data.organization;
    },
  });

  rl.registerAction("organization.get", {
    access: "read",
    description: "Get an organization",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(
        ctx,
        "GET",
        `organizations/${seg((input as Record<string, unknown>).id)}`,
      )) as Record<string, unknown>;
      return data.organization;
    },
  });

  rl.registerAction("organization.list", {
    access: "read",
    description: "List organizations",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit)
        qs.per_page = (input as Record<string, unknown>).limit;
      const data = (await api(
        ctx,
        "GET",
        "organizations",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.organizations;
    },
  });

  rl.registerAction("organization.update", {
    access: "write",
    description: "Update an organization",
    inputSchema: {
      id: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(ctx, "PUT", `organizations/${seg(p.id)}`, {
        organization: p.data,
      })) as Record<string, unknown>;
      return data.organization;
    },
  });

  rl.registerAction("organization.delete", {
    access: "write",
    description: "Delete an organization",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `organizations/${seg((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  // ── Ticket Field ────────────────────────────────────

  rl.registerAction("ticketField.get", {
    access: "read",
    description: "Get a ticket field",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(
        ctx,
        "GET",
        `ticket_fields/${seg((input as Record<string, unknown>).id)}`,
      )) as Record<string, unknown>;
      return data.ticket_field;
    },
  });

  rl.registerAction("ticketField.list", {
    access: "read",
    description: "List ticket fields",
    inputSchema: {},
    async execute(_input, ctx) {
      const data = (await api(ctx, "GET", "ticket_fields")) as Record<
        string,
        unknown
      >;
      return data.ticket_fields;
    },
  });
}
