import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { twistCredential } from "./credentials.js";

function api(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, twistCredential, "twist", {
    target: "api",
    path: endpoint.replace(/^\//, ""),
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

export default function twist(rl: RunlinePluginAPI) {
  rl.setName("twist");
  rl.setVersion("0.1.0");
  rl.setCredential(twistCredential);
  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Twist OAuth2 access token",
      env: "TWIST_ACCESS_TOKEN",
    },
  });

  // ── Channel ─────────────────────────────────────────

  rl.registerAction("channel.create", {
    access: "write",
    description: "Create a channel",
    inputSchema: {
      workspaceId: { type: "number", required: true },
      name: { type: "string", required: true },
    },
    async execute(input, ctx) {
      return api(ctx, "POST", "/channels/add", {
        workspace_id: (input as Record<string, unknown>).workspaceId,
        name: (input as Record<string, unknown>).name,
      });
    },
  });

  rl.registerAction("channel.get", {
    access: "read",
    description: "Get a channel",
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      return api(ctx, "GET", "/channels/getone", undefined, {
        id: (input as Record<string, unknown>).id,
      });
    },
  });

  rl.registerAction("channel.list", {
    access: "read",
    description: "List channels in a workspace",
    inputSchema: {
      workspaceId: { type: "number", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(ctx, "GET", "/channels/get", undefined, {
        workspace_id: p.workspaceId,
      })) as unknown[];
      return p.limit ? data.slice(0, p.limit as number) : data;
    },
  });

  rl.registerAction("channel.update", {
    access: "write",
    description: "Update a channel",
    inputSchema: {
      id: { type: "number", required: true },
      name: { type: "string", required: false },
      description: { type: "string", required: false },
    },
    async execute(input, ctx) {
      return api(
        ctx,
        "POST",
        "/channels/update",
        input as Record<string, unknown>,
      );
    },
  });

  rl.registerAction("channel.delete", {
    access: "write",
    description: "Delete a channel",
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      return api(ctx, "POST", "/channels/remove", undefined, {
        id: (input as Record<string, unknown>).id,
      });
    },
  });

  rl.registerAction("channel.archive", {
    access: "write",
    description: "Archive a channel",
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      return api(ctx, "POST", "/channels/archive", undefined, {
        id: (input as Record<string, unknown>).id,
      });
    },
  });

  rl.registerAction("channel.unarchive", {
    access: "write",
    description: "Unarchive a channel",
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      return api(ctx, "POST", "/channels/unarchive", undefined, {
        id: (input as Record<string, unknown>).id,
      });
    },
  });

  // ── Thread ──────────────────────────────────────────

  rl.registerAction("thread.create", {
    access: "write",
    description: "Create a thread",
    inputSchema: {
      channelId: { type: "number", required: true },
      title: { type: "string", required: true },
      content: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(ctx, "POST", "/threads/add", {
        channel_id: p.channelId,
        title: p.title,
        content: p.content,
      });
    },
  });

  rl.registerAction("thread.get", {
    access: "read",
    description: "Get a thread",
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      return api(ctx, "GET", "/threads/getone", undefined, {
        id: (input as Record<string, unknown>).id,
      });
    },
  });

  rl.registerAction("thread.list", {
    access: "read",
    description: "List threads in a channel",
    inputSchema: {
      channelId: { type: "number", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { channel_id: p.channelId };
      if (p.limit) qs.limit = p.limit;
      return api(ctx, "GET", "/threads/get", undefined, qs);
    },
  });

  rl.registerAction("thread.update", {
    access: "write",
    description: "Update a thread",
    inputSchema: {
      id: { type: "number", required: true },
      title: { type: "string", required: false },
      content: { type: "string", required: false },
    },
    async execute(input, ctx) {
      return api(
        ctx,
        "POST",
        "/threads/update",
        input as Record<string, unknown>,
      );
    },
  });

  rl.registerAction("thread.delete", {
    access: "write",
    description: "Delete a thread",
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      return api(ctx, "POST", "/threads/remove", undefined, {
        id: (input as Record<string, unknown>).id,
      });
    },
  });

  // ── Comment ─────────────────────────────────────────

  rl.registerAction("comment.create", {
    access: "write",
    description: "Add a comment to a thread",
    inputSchema: {
      threadId: { type: "number", required: true },
      content: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(ctx, "POST", "/comments/add", {
        thread_id: p.threadId,
        content: p.content,
      });
    },
  });

  rl.registerAction("comment.get", {
    access: "read",
    description: "Get a comment",
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      const data = (await api(ctx, "GET", "/comments/getone", undefined, {
        id: (input as Record<string, unknown>).id,
      })) as Record<string, unknown>;
      return data.comment ?? data;
    },
  });

  rl.registerAction("comment.list", {
    access: "read",
    description: "List comments in a thread",
    inputSchema: {
      threadId: { type: "number", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { thread_id: p.threadId };
      if (p.limit) qs.limit = p.limit;
      return api(ctx, "GET", "/comments/get", undefined, qs);
    },
  });

  rl.registerAction("comment.update", {
    access: "write",
    description: "Update a comment",
    inputSchema: {
      id: { type: "number", required: true },
      content: { type: "string", required: false },
    },
    async execute(input, ctx) {
      return api(
        ctx,
        "POST",
        "/comments/update",
        input as Record<string, unknown>,
      );
    },
  });

  rl.registerAction("comment.delete", {
    access: "write",
    description: "Delete a comment",
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      return api(ctx, "POST", "/comments/remove", undefined, {
        id: (input as Record<string, unknown>).id,
      });
    },
  });

  // ── Message Conversation ────────────────────────────

  rl.registerAction("messageConversation.create", {
    access: "write",
    description: "Send a message in a conversation",
    inputSchema: {
      workspaceId: { type: "number", required: true },
      conversationId: { type: "number", required: true },
      content: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(ctx, "POST", "/conversation_messages/add", {
        workspace_id: p.workspaceId,
        conversation_id: p.conversationId,
        content: p.content,
      });
    },
  });

  rl.registerAction("messageConversation.get", {
    access: "read",
    description: "Get a conversation message",
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      return api(ctx, "GET", "/conversation_messages/getone", undefined, {
        id: (input as Record<string, unknown>).id,
      });
    },
  });

  rl.registerAction("messageConversation.list", {
    access: "read",
    description: "List messages in a conversation",
    inputSchema: { conversationId: { type: "number", required: true } },
    async execute(input, ctx) {
      return api(ctx, "GET", "/conversation_messages/get", undefined, {
        conversation_id: (input as Record<string, unknown>).conversationId,
      });
    },
  });

  rl.registerAction("messageConversation.update", {
    access: "write",
    description: "Update a conversation message",
    inputSchema: {
      id: { type: "number", required: true },
      content: { type: "string", required: false },
    },
    async execute(input, ctx) {
      return api(
        ctx,
        "POST",
        "/conversation_messages/update",
        input as Record<string, unknown>,
      );
    },
  });

  rl.registerAction("messageConversation.delete", {
    access: "write",
    description: "Delete a conversation message",
    inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      return api(ctx, "POST", "/conversation_messages/remove", undefined, {
        id: (input as Record<string, unknown>).id,
      });
    },
  });
}
