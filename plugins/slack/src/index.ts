import type { RunlinePluginAPI } from "runline";

async function api(token: string, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`https://slack.com/api${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Slack HTTP error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.ok === false) throw new Error(`Slack API error: ${data.error}`);
  return data;
}

export default function slack(rl: RunlinePluginAPI) {
  rl.setName("slack");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({ accessToken: { type: "string", required: true, description: "Slack Bot/User token", env: "SLACK_ACCESS_TOKEN" } });
  const t = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.accessToken as string;

  // ── Message ─────────────────────────────────────────

  rl.registerAction("message.post", { description: "Post a message to a channel or user",
    inputSchema: { channel: { type: "string", required: true }, text: { type: "string", required: false }, blocks: { type: "object", required: false }, threadTs: { type: "string", required: false }, replyBroadcast: { type: "boolean", required: false }, unfurlLinks: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { channel: p.channel };
      if (p.text) body.text = p.text;
      if (p.blocks) body.blocks = p.blocks;
      if (p.threadTs) body.thread_ts = p.threadTs;
      if (p.replyBroadcast) body.reply_broadcast = true;
      if (p.unfurlLinks !== undefined) body.unfurl_links = p.unfurlLinks;
      return api(t(ctx), "POST", "/chat.postMessage", body);
    } });

  rl.registerAction("message.update", { description: "Update a message",
    inputSchema: { channel: { type: "string", required: true }, ts: { type: "string", required: true }, text: { type: "string", required: false }, blocks: { type: "object", required: false } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/chat.update", input as Record<string, unknown>); } });

  rl.registerAction("message.delete", { description: "Delete a message",
    inputSchema: { channel: { type: "string", required: true }, ts: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/chat.delete", input as Record<string, unknown>); } });

  rl.registerAction("message.getPermalink", { description: "Get a message permalink",
    inputSchema: { channel: { type: "string", required: true }, messageTs: { type: "string", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(t(ctx), "GET", "/chat.getPermalink", undefined, { channel: p.channel, message_ts: p.messageTs }); } });

  rl.registerAction("message.search", { description: "Search messages",
    inputSchema: { query: { type: "string", required: true }, sort: { type: "string", required: false, description: "score or timestamp" }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { query: p.query };
      if (p.sort) qs.sort = p.sort === "relevance" ? "score" : "timestamp";
      if (p.limit) qs.count = p.limit;
      const data = (await api(t(ctx), "POST", "/search.messages", undefined, qs)) as Record<string, unknown>;
      return (data.messages as Record<string, unknown>)?.matches;
    } });

  // ── Channel ─────────────────────────────────────────

  rl.registerAction("channel.create", { description: "Create a channel",
    inputSchema: { name: { type: "string", required: true }, isPrivate: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(t(ctx), "POST", "/conversations.create", { name: p.name, is_private: p.isPrivate ?? false })) as Record<string, unknown>;
      return data.channel;
    } });

  rl.registerAction("channel.get", { description: "Get channel info",
    inputSchema: { channel: { type: "string", required: true } },
    async execute(input, ctx) { const data = (await api(t(ctx), "POST", "/conversations.info", undefined, { channel: (input as Record<string, unknown>).channel })) as Record<string, unknown>; return data.channel; } });

  rl.registerAction("channel.list", { description: "List channels",
    inputSchema: { limit: { type: "number", required: false }, types: { type: "string", required: false, description: "Comma-separated: public_channel,private_channel" }, excludeArchived: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { types: p.types ?? "public_channel,private_channel" };
      if (p.limit) qs.limit = p.limit;
      if (p.excludeArchived) qs.exclude_archived = true;
      const data = (await api(t(ctx), "GET", "/conversations.list", undefined, qs)) as Record<string, unknown>;
      return data.channels;
    } });

  rl.registerAction("channel.history", { description: "Get channel message history",
    inputSchema: { channel: { type: "string", required: true }, limit: { type: "number", required: false }, oldest: { type: "string", required: false, description: "ISO datetime" }, latest: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { channel: p.channel };
      if (p.limit) qs.limit = p.limit;
      if (p.oldest) qs.oldest = new Date(p.oldest as string).getTime() / 1000;
      if (p.latest) qs.latest = new Date(p.latest as string).getTime() / 1000;
      const data = (await api(t(ctx), "GET", "/conversations.history", undefined, qs)) as Record<string, unknown>;
      return data.messages;
    } });

  rl.registerAction("channel.replies", { description: "Get thread replies",
    inputSchema: { channel: { type: "string", required: true }, ts: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { channel: p.channel, ts: p.ts };
      if (p.limit) qs.limit = p.limit;
      const data = (await api(t(ctx), "GET", "/conversations.replies", undefined, qs)) as Record<string, unknown>;
      return data.messages;
    } });

  rl.registerAction("channel.invite", { description: "Invite users to a channel",
    inputSchema: { channel: { type: "string", required: true }, users: { type: "string", required: true, description: "Comma-separated user IDs" } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; const data = (await api(t(ctx), "POST", "/conversations.invite", { channel: p.channel, users: p.users })) as Record<string, unknown>; return data.channel; } });

  rl.registerAction("channel.kick", { description: "Remove a user from a channel",
    inputSchema: { channel: { type: "string", required: true }, user: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/conversations.kick", input as Record<string, unknown>); } });

  rl.registerAction("channel.join", { description: "Join a channel",
    inputSchema: { channel: { type: "string", required: true } },
    async execute(input, ctx) { const data = (await api(t(ctx), "POST", "/conversations.join", { channel: (input as Record<string, unknown>).channel })) as Record<string, unknown>; return data.channel; } });

  rl.registerAction("channel.leave", { description: "Leave a channel",
    inputSchema: { channel: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/conversations.leave", { channel: (input as Record<string, unknown>).channel }); } });

  rl.registerAction("channel.archive", { description: "Archive a channel",
    inputSchema: { channel: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/conversations.archive", { channel: (input as Record<string, unknown>).channel }); } });

  rl.registerAction("channel.unarchive", { description: "Unarchive a channel",
    inputSchema: { channel: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/conversations.unarchive", { channel: (input as Record<string, unknown>).channel }); } });

  rl.registerAction("channel.rename", { description: "Rename a channel",
    inputSchema: { channel: { type: "string", required: true }, name: { type: "string", required: true } },
    async execute(input, ctx) { const data = (await api(t(ctx), "POST", "/conversations.rename", input as Record<string, unknown>)) as Record<string, unknown>; return data.channel; } });

  rl.registerAction("channel.setTopic", { description: "Set channel topic",
    inputSchema: { channel: { type: "string", required: true }, topic: { type: "string", required: true } },
    async execute(input, ctx) { const data = (await api(t(ctx), "POST", "/conversations.setTopic", input as Record<string, unknown>)) as Record<string, unknown>; return data.channel; } });

  rl.registerAction("channel.setPurpose", { description: "Set channel purpose",
    inputSchema: { channel: { type: "string", required: true }, purpose: { type: "string", required: true } },
    async execute(input, ctx) { const data = (await api(t(ctx), "POST", "/conversations.setPurpose", input as Record<string, unknown>)) as Record<string, unknown>; return data.channel; } });

  rl.registerAction("channel.members", { description: "List channel members",
    inputSchema: { channel: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { channel: p.channel };
      if (p.limit) qs.limit = p.limit;
      const data = (await api(t(ctx), "GET", "/conversations.members", undefined, qs)) as Record<string, unknown>;
      return (data.members as string[]).map(m => ({ member: m }));
    } });

  // ── Reaction ────────────────────────────────────────

  rl.registerAction("reaction.add", { description: "Add a reaction to a message",
    inputSchema: { channel: { type: "string", required: true }, timestamp: { type: "string", required: true }, name: { type: "string", required: true, description: "Emoji name without colons" } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/reactions.add", input as Record<string, unknown>); } });

  rl.registerAction("reaction.remove", { description: "Remove a reaction",
    inputSchema: { channel: { type: "string", required: true }, timestamp: { type: "string", required: true }, name: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/reactions.remove", input as Record<string, unknown>); } });

  rl.registerAction("reaction.get", { description: "Get reactions for a message",
    inputSchema: { channel: { type: "string", required: true }, timestamp: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", "/reactions.get", undefined, input as Record<string, unknown>); } });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.info", { description: "Get user info",
    inputSchema: { user: { type: "string", required: true } },
    async execute(input, ctx) { const data = (await api(t(ctx), "GET", "/users.info", undefined, { user: (input as Record<string, unknown>).user })) as Record<string, unknown>; return data.user; } });

  rl.registerAction("user.list", { description: "List all users",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit) qs.limit = (input as Record<string, unknown>).limit;
      const data = (await api(t(ctx), "GET", "/users.list", undefined, qs)) as Record<string, unknown>;
      return data.members;
    } });

  rl.registerAction("user.getPresence", { description: "Get a user's presence",
    inputSchema: { user: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", "/users.getPresence", undefined, { user: (input as Record<string, unknown>).user }); } });

  rl.registerAction("user.getProfile", { description: "Get a user's profile",
    inputSchema: { user: { type: "string", required: true } },
    async execute(input, ctx) { const data = (await api(t(ctx), "GET", "/users.profile.get", undefined, { user: (input as Record<string, unknown>).user })) as Record<string, unknown>; return data.profile; } });

  rl.registerAction("user.updateProfile", { description: "Update the authenticated user's profile",
    inputSchema: { profile: { type: "object", required: true, description: "Profile fields to set" } },
    async execute(input, ctx) { const data = (await api(t(ctx), "POST", "/users.profile.set", { profile: (input as Record<string, unknown>).profile })) as Record<string, unknown>; return data.profile; } });

  // ── User Group ──────────────────────────────────────

  rl.registerAction("userGroup.create", { description: "Create a user group",
    inputSchema: { name: { type: "string", required: true }, handle: { type: "string", required: false }, description: { type: "string", required: false } },
    async execute(input, ctx) { const data = (await api(t(ctx), "POST", "/usergroups.create", input as Record<string, unknown>)) as Record<string, unknown>; return data.usergroup; } });

  rl.registerAction("userGroup.list", { description: "List user groups",
    inputSchema: { includeUsers: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.includeUsers) qs.include_users = true;
      const data = (await api(t(ctx), "GET", "/usergroups.list", undefined, qs)) as Record<string, unknown>;
      return data.usergroups;
    } });

  rl.registerAction("userGroup.update", { description: "Update a user group",
    inputSchema: { usergroup: { type: "string", required: true }, name: { type: "string", required: false }, handle: { type: "string", required: false }, description: { type: "string", required: false } },
    async execute(input, ctx) { const data = (await api(t(ctx), "POST", "/usergroups.update", input as Record<string, unknown>)) as Record<string, unknown>; return data.usergroup; } });

  rl.registerAction("userGroup.enable", { description: "Enable a user group",
    inputSchema: { usergroup: { type: "string", required: true } },
    async execute(input, ctx) { const data = (await api(t(ctx), "POST", "/usergroups.enable", { usergroup: (input as Record<string, unknown>).usergroup })) as Record<string, unknown>; return data.usergroup; } });

  rl.registerAction("userGroup.disable", { description: "Disable a user group",
    inputSchema: { usergroup: { type: "string", required: true } },
    async execute(input, ctx) { const data = (await api(t(ctx), "POST", "/usergroups.disable", { usergroup: (input as Record<string, unknown>).usergroup })) as Record<string, unknown>; return data.usergroup; } });

  // ── File ────────────────────────────────────────────

  rl.registerAction("file.get", { description: "Get file info",
    inputSchema: { file: { type: "string", required: true } },
    async execute(input, ctx) { const data = (await api(t(ctx), "GET", "/files.info", undefined, { file: (input as Record<string, unknown>).file })) as Record<string, unknown>; return data.file; } });

  rl.registerAction("file.list", { description: "List files",
    inputSchema: { channel: { type: "string", required: false }, limit: { type: "number", required: false }, types: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.channel) qs.channel = p.channel;
      if (p.limit) qs.count = p.limit;
      if (p.types) qs.types = p.types;
      const data = (await api(t(ctx), "GET", "/files.list", undefined, qs)) as Record<string, unknown>;
      return data.files;
    } });

  // ── Star ────────────────────────────────────────────

  rl.registerAction("star.add", { description: "Star an item",
    inputSchema: { channel: { type: "string", required: false }, timestamp: { type: "string", required: false }, file: { type: "string", required: false } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/stars.add", input as Record<string, unknown>); } });

  rl.registerAction("star.remove", { description: "Unstar an item",
    inputSchema: { channel: { type: "string", required: false }, timestamp: { type: "string", required: false }, file: { type: "string", required: false } },
    async execute(input, ctx) { return api(t(ctx), "POST", "/stars.remove", input as Record<string, unknown>); } });

  rl.registerAction("star.list", { description: "List starred items",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit) qs.limit = (input as Record<string, unknown>).limit;
      const data = (await api(t(ctx), "GET", "/stars.list", undefined, qs)) as Record<string, unknown>;
      return data.items;
    } });
}
