import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return {
    subdomain: c.subdomain as string,
    email: c.email as string,
    apiToken: c.apiToken as string,
  };
}

async function api(
  conn: ReturnType<typeof getConn>,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(
    `https://${conn.subdomain}.zendesk.com/api/v2${endpoint}.json`,
  );
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${conn.email}/token:${conn.apiToken}`)}`,
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok)
    throw new Error(`Zendesk error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

export default function zendesk(rl: RunlinePluginAPI) {
  rl.setName("zendesk");
  rl.setVersion("0.1.0");
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
      const data = (await api(getConn(ctx), "POST", "/tickets", {
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
        getConn(ctx),
        "GET",
        `/tickets/${(input as Record<string, unknown>).id}`,
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
      const data = (await api(
        getConn(ctx),
        "GET",
        "/search",
        undefined,
        qs,
      )) as Record<string, unknown>;
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
      const data = (await api(getConn(ctx), "PUT", `/tickets/${p.id}`, {
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
        getConn(ctx),
        "DELETE",
        `/tickets/${(input as Record<string, unknown>).id}`,
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
      const data = (await api(getConn(ctx), "POST", "/users", {
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
        getConn(ctx),
        "GET",
        `/users/${(input as Record<string, unknown>).id}`,
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
      const data = (await api(
        getConn(ctx),
        "GET",
        "/users",
        undefined,
        qs,
      )) as Record<string, unknown>;
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
      const data = (await api(getConn(ctx), "PUT", `/users/${p.id}`, {
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
        getConn(ctx),
        "DELETE",
        `/users/${(input as Record<string, unknown>).id}`,
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
        getConn(ctx),
        "GET",
        "/users/search",
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
      const data = (await api(getConn(ctx), "POST", "/organizations", {
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
        getConn(ctx),
        "GET",
        `/organizations/${(input as Record<string, unknown>).id}`,
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
        getConn(ctx),
        "GET",
        "/organizations",
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
      const data = (await api(getConn(ctx), "PUT", `/organizations/${p.id}`, {
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
        getConn(ctx),
        "DELETE",
        `/organizations/${(input as Record<string, unknown>).id}`,
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
        getConn(ctx),
        "GET",
        `/ticket_fields/${(input as Record<string, unknown>).id}`,
      )) as Record<string, unknown>;
      return data.ticket_field;
    },
  });

  rl.registerAction("ticketField.list", {
    access: "read",
    description: "List ticket fields",
    inputSchema: {},
    async execute(_input, ctx) {
      const data = (await api(getConn(ctx), "GET", "/ticket_fields")) as Record<
        string,
        unknown
      >;
      return data.ticket_fields;
    },
  });
}
