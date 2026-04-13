import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.twist.com/api/v3";

async function api(token: string, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Twist error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function twist(rl: RunlinePluginAPI) {
  rl.setName("twist");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({ accessToken: { type: "string", required: true, description: "Twist OAuth2 access token", env: "TWIST_ACCESS_TOKEN" } });
  const t = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.accessToken as string;

  // ── Channel ─────────────────────────────────────────

  rl.registerAction("channel.create", { description: "Create a channel", inputSchema: { workspaceId: { type: "number", required: true }, name: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/channels/add", { workspace_id: (input as Record<string, unknown>).workspaceId, name: (input as Record<string, unknown>).name }); } });

  rl.registerAction("channel.get", { description: "Get a channel", inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", "/channels/getone", undefined, { id: (input as Record<string, unknown>).id }); } });

  rl.registerAction("channel.list", { description: "List channels in a workspace", inputSchema: { workspaceId: { type: "number", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(t(ctx), "GET", "/channels/get", undefined, { workspace_id: p.workspaceId })) as unknown[];
      return p.limit ? data.slice(0, p.limit as number) : data;
    } });

  rl.registerAction("channel.update", { description: "Update a channel", inputSchema: { id: { type: "number", required: true }, name: { type: "string", required: false }, description: { type: "string", required: false } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/channels/update", input as Record<string, unknown>); } });

  rl.registerAction("channel.delete", { description: "Delete a channel", inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/channels/remove", undefined, { id: (input as Record<string, unknown>).id }); } });

  rl.registerAction("channel.archive", { description: "Archive a channel", inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/channels/archive", undefined, { id: (input as Record<string, unknown>).id }); } });

  rl.registerAction("channel.unarchive", { description: "Unarchive a channel", inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/channels/unarchive", undefined, { id: (input as Record<string, unknown>).id }); } });

  // ── Thread ──────────────────────────────────────────

  rl.registerAction("thread.create", { description: "Create a thread", inputSchema: { channelId: { type: "number", required: true }, title: { type: "string", required: true }, content: { type: "string", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(t(ctx), "POST", "/threads/add", { channel_id: p.channelId, title: p.title, content: p.content }); } });

  rl.registerAction("thread.get", { description: "Get a thread", inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", "/threads/getone", undefined, { id: (input as Record<string, unknown>).id }); } });

  rl.registerAction("thread.list", { description: "List threads in a channel", inputSchema: { channelId: { type: "number", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { channel_id: p.channelId };
      if (p.limit) qs.limit = p.limit;
      return api(t(ctx), "GET", "/threads/get", undefined, qs);
    } });

  rl.registerAction("thread.update", { description: "Update a thread", inputSchema: { id: { type: "number", required: true }, title: { type: "string", required: false }, content: { type: "string", required: false } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/threads/update", input as Record<string, unknown>); } });

  rl.registerAction("thread.delete", { description: "Delete a thread", inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/threads/remove", undefined, { id: (input as Record<string, unknown>).id }); } });

  // ── Comment ─────────────────────────────────────────

  rl.registerAction("comment.create", { description: "Add a comment to a thread", inputSchema: { threadId: { type: "number", required: true }, content: { type: "string", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(t(ctx), "POST", "/comments/add", { thread_id: p.threadId, content: p.content }); } });

  rl.registerAction("comment.get", { description: "Get a comment", inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) {
      const data = (await api(t(ctx), "GET", "/comments/getone", undefined, { id: (input as Record<string, unknown>).id })) as Record<string, unknown>;
      return data.comment ?? data;
    } });

  rl.registerAction("comment.list", { description: "List comments in a thread", inputSchema: { threadId: { type: "number", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { thread_id: p.threadId };
      if (p.limit) qs.limit = p.limit;
      return api(t(ctx), "GET", "/comments/get", undefined, qs);
    } });

  rl.registerAction("comment.update", { description: "Update a comment", inputSchema: { id: { type: "number", required: true }, content: { type: "string", required: false } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/comments/update", input as Record<string, unknown>); } });

  rl.registerAction("comment.delete", { description: "Delete a comment", inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/comments/remove", undefined, { id: (input as Record<string, unknown>).id }); } });

  // ── Message Conversation ────────────────────────────

  rl.registerAction("messageConversation.create", { description: "Send a message in a conversation", inputSchema: { workspaceId: { type: "number", required: true }, conversationId: { type: "number", required: true }, content: { type: "string", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(t(ctx), "POST", "/conversation_messages/add", { workspace_id: p.workspaceId, conversation_id: p.conversationId, content: p.content }); } });

  rl.registerAction("messageConversation.get", { description: "Get a conversation message", inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", "/conversation_messages/getone", undefined, { id: (input as Record<string, unknown>).id }); } });

  rl.registerAction("messageConversation.list", { description: "List messages in a conversation", inputSchema: { conversationId: { type: "number", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", "/conversation_messages/get", undefined, { conversation_id: (input as Record<string, unknown>).conversationId }); } });

  rl.registerAction("messageConversation.update", { description: "Update a conversation message", inputSchema: { id: { type: "number", required: true }, content: { type: "string", required: false } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/conversation_messages/update", input as Record<string, unknown>); } });

  rl.registerAction("messageConversation.delete", { description: "Delete a conversation message", inputSchema: { id: { type: "number", required: true } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/conversation_messages/remove", undefined, { id: (input as Record<string, unknown>).id }); } });
}
