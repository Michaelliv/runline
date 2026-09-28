import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { zulipCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function encodeForm(body: Record<string, unknown>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null)
      form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return form;
}

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const form =
    body && Object.keys(body).length > 0 ? encodeForm(body) : undefined;
  // GET parameters ride in the query string; a GET carries no body.
  const query = method === "GET" ? form : undefined;
  return credentialJson(ctx, zulipCredential, "zulip", {
    target: "api",
    path: query ? `${path}?${query}` : path,
    method,
    ...(form && !query
      ? {
          body: form.toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      : {}),
  });
}

export default function zulip(rl: RunlinePluginAPI) {
  rl.setName("zulip");
  rl.setVersion("0.1.0");
  rl.setCredential(zulipCredential);
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
      return apiRequest(ctx, "POST", "messages", {
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
      return apiRequest(ctx, "POST", "messages", {
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
        ctx,
        "GET",
        `messages/${seg((input as Record<string, unknown>).messageId)}`,
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
      return apiRequest(ctx, "PATCH", `messages/${seg(messageId)}`, fields);
    },
  });

  rl.registerAction("message.delete", {
    access: "write",
    description: "Delete a message",
    inputSchema: { messageId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "DELETE",
        `messages/${seg((input as Record<string, unknown>).messageId)}`,
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
      const data = (await apiRequest(ctx, "GET", "streams", body)) as Record<
        string,
        unknown
      >;
      return data.streams;
    },
  });

  rl.registerAction("stream.listSubscribed", {
    access: "read",
    description: "List subscribed streams",
    inputSchema: {},
    async execute(_input, ctx) {
      const data = (await apiRequest(
        ctx,
        "GET",
        "users/me/subscriptions",
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
      return apiRequest(ctx, "POST", "users/me/subscriptions", body);
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
      return apiRequest(ctx, "PATCH", `streams/${seg(streamId)}`, body);
    },
  });

  rl.registerAction("stream.delete", {
    access: "write",
    description: "Delete a stream",
    inputSchema: { streamId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "DELETE",
        `streams/${seg((input as Record<string, unknown>).streamId)}`,
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
        ctx,
        "GET",
        `users/${seg((input as Record<string, unknown>).userId)}`,
      );
    },
  });

  rl.registerAction("user.list", {
    access: "read",
    description: "List all users",
    inputSchema: {},
    async execute(_input, ctx) {
      const data = (await apiRequest(ctx, "GET", "users")) as Record<
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
      return apiRequest(ctx, "POST", "users", {
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
      return apiRequest(ctx, "PATCH", `users/${seg(userId)}`, body);
    },
  });

  rl.registerAction("user.deactivate", {
    access: "write",
    description: "Deactivate a user",
    inputSchema: { userId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "DELETE",
        `users/${seg((input as Record<string, unknown>).userId)}`,
      );
    },
  });
}
