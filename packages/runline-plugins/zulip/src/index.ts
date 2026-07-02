import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return {
    url: (c.url as string).replace(/\/$/, ""),
    email: c.email as string,
    apiKey: c.apiKey as string,
  };
}

async function apiRequest(
  conn: ReturnType<typeof getConn>,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = `${conn.url}/api/v1${endpoint}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${conn.email}:${conn.apiKey}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };
  if (body && Object.keys(body).length > 0) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null)
        form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    init.body = form;
  }
  const res = await fetch(url, init);
  if (!res.ok)
    throw new Error(`Zulip error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function zulip(rl: RunlinePluginAPI) {
  rl.setName("zulip");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "Zulip server URL",
      env: "ZULIP_URL",
    },
    email: {
      type: "string",
      required: true,
      description: "Bot email",
      env: "ZULIP_EMAIL",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "Bot API key",
      env: "ZULIP_API_KEY",
    },
  });

  // ── Message ─────────────────────────────────────────

  rl.registerAction("message.sendPrivate", {
    access: "write",
    description: "Send a private/direct message",
    inputSchema: {
      to: {
        type: "string",
        required: true,
        description: "Comma-separated emails",
      },
      content: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "/messages", {
        type: "private",
        to: p.to,
        content: p.content,
      });
    },
  });

  rl.registerAction("message.sendStream", {
    access: "write",
    description: "Send a message to a stream",
    inputSchema: {
      stream: {
        type: "string",
        required: true,
        description: "Stream name or ID",
      },
      topic: { type: "string", required: true },
      content: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "/messages", {
        type: "stream",
        to: p.stream,
        topic: p.topic,
        content: p.content,
      });
    },
  });

  rl.registerAction("message.get", {
    access: "read",
    description: "Get a message by ID",
    inputSchema: { messageId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        getConn(ctx),
        "GET",
        `/messages/${(input as Record<string, unknown>).messageId}`,
      );
    },
  });

  rl.registerAction("message.update", {
    access: "write",
    description: "Update a message",
    inputSchema: {
      messageId: { type: "string", required: true },
      content: { type: "string", required: false },
      topic: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { messageId, ...fields } = input as Record<string, unknown>;
      return apiRequest(
        getConn(ctx),
        "PATCH",
        `/messages/${messageId}`,
        fields,
      );
    },
  });

  rl.registerAction("message.delete", {
    access: "write",
    description: "Delete a message",
    inputSchema: { messageId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        getConn(ctx),
        "DELETE",
        `/messages/${(input as Record<string, unknown>).messageId}`,
      );
    },
  });

  // ── Stream ──────────────────────────────────────────

  rl.registerAction("stream.list", {
    access: "read",
    description: "List all streams",
    inputSchema: {
      includePublic: { type: "boolean", required: false },
      includeSubscribed: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.includePublic !== undefined) body.include_public = p.includePublic;
      if (p.includeSubscribed !== undefined)
        body.include_subscribed = p.includeSubscribed;
      const data = (await apiRequest(
        getConn(ctx),
        "GET",
        "/streams",
        body,
      )) as Record<string, unknown>;
      return data.streams;
    },
  });

  rl.registerAction("stream.listSubscribed", {
    access: "read",
    description: "List subscribed streams",
    inputSchema: {},
    async execute(_input, ctx) {
      const data = (await apiRequest(
        getConn(ctx),
        "GET",
        "/users/me/subscriptions",
      )) as Record<string, unknown>;
      return data.subscriptions;
    },
  });

  rl.registerAction("stream.create", {
    access: "write",
    description: "Subscribe to / create a stream",
    inputSchema: {
      name: { type: "string", required: true },
      description: { type: "string", required: false },
      inviteOnly: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        subscriptions: JSON.stringify([
          { name: p.name, description: p.description || "" },
        ]),
      };
      if (p.inviteOnly !== undefined) body.invite_only = p.inviteOnly;
      return apiRequest(getConn(ctx), "POST", "/users/me/subscriptions", body);
    },
  });

  rl.registerAction("stream.update", {
    access: "write",
    description: "Update a stream",
    inputSchema: {
      streamId: { type: "string", required: true },
      description: { type: "string", required: false },
      newName: { type: "string", required: false },
      isPrivate: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const { streamId, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.description)
        body.description = JSON.stringify(fields.description);
      if (fields.newName) body.new_name = JSON.stringify(fields.newName);
      if (fields.isPrivate !== undefined) body.is_private = fields.isPrivate;
      return apiRequest(getConn(ctx), "PATCH", `/streams/${streamId}`, body);
    },
  });

  rl.registerAction("stream.delete", {
    access: "write",
    description: "Delete a stream",
    inputSchema: { streamId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        getConn(ctx),
        "DELETE",
        `/streams/${(input as Record<string, unknown>).streamId}`,
      );
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.get", {
    access: "read",
    description: "Get a user by ID",
    inputSchema: { userId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        getConn(ctx),
        "GET",
        `/users/${(input as Record<string, unknown>).userId}`,
      );
    },
  });

  rl.registerAction("user.list", {
    access: "read",
    description: "List all users",
    inputSchema: {},
    async execute(_input, ctx) {
      const data = (await apiRequest(getConn(ctx), "GET", "/users")) as Record<
        string,
        unknown
      >;
      return data.members;
    },
  });

  rl.registerAction("user.create", {
    access: "write",
    description: "Create a user",
    inputSchema: {
      email: { type: "string", required: true },
      password: { type: "string", required: true },
      fullName: { type: "string", required: true },
      shortName: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "/users", {
        email: p.email,
        password: p.password,
        full_name: p.fullName,
        short_name: p.shortName,
      });
    },
  });

  rl.registerAction("user.update", {
    access: "write",
    description: "Update a user",
    inputSchema: {
      userId: { type: "string", required: true },
      fullName: { type: "string", required: false },
      role: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const { userId, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.fullName) body.full_name = JSON.stringify(fields.fullName);
      if (fields.role !== undefined) body.role = fields.role;
      return apiRequest(getConn(ctx), "PATCH", `/users/${userId}`, body);
    },
  });

  rl.registerAction("user.deactivate", {
    access: "write",
    description: "Deactivate a user",
    inputSchema: { userId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        getConn(ctx),
        "DELETE",
        `/users/${(input as Record<string, unknown>).userId}`,
      );
    },
  });
}
