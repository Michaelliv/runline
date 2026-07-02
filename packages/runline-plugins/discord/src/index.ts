import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://discord.com/api/v10";

async function apiRequest(
  botToken: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  ) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok)
    throw new Error(`Discord API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    botToken: ctx.connection.config.botToken as string,
    guildId: ctx.connection.config.guildId as string,
  };
}

export default function discord(rl: RunlinePluginAPI) {
  rl.setName("discord");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    botToken: {
      type: "string",
      required: true,
      description: "Discord bot token",
      env: "DISCORD_BOT_TOKEN",
    },
    guildId: {
      type: "string",
      required: true,
      description: "Default guild (server) ID",
      env: "DISCORD_GUILD_ID",
    },
  });

  // ── Channel ─────────────────────────────────────────

  rl.registerAction("channel.create", {
    access: "write",
    description: "Create a channel in the guild",
    inputSchema: {
      name: { type: "string", required: true, description: "Channel name" },
      type: {
        type: "number",
        required: false,
        description: "Type: 0=text (default), 2=voice, 4=category",
      },
      topic: {
        type: "string",
        required: false,
        description: "Channel topic (0-1024 chars)",
      },
      parentId: {
        type: "string",
        required: false,
        description: "Category ID to nest under",
      },
      position: {
        type: "number",
        required: false,
        description: "Sorting position",
      },
      nsfw: { type: "boolean", required: false, description: "Mark as NSFW" },
      bitrate: {
        type: "number",
        required: false,
        description: "Bitrate for voice channels (8000-96000)",
      },
      userLimit: {
        type: "number",
        required: false,
        description: "User limit for voice channels (0=no limit)",
      },
      rateLimitPerUser: {
        type: "number",
        required: false,
        description: "Slowmode seconds",
      },
    },
    async execute(input, ctx) {
      const { botToken, guildId } = getConn(ctx);
      const {
        name,
        type,
        topic,
        parentId,
        position,
        nsfw,
        bitrate,
        userLimit,
        rateLimitPerUser,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name, type: type ?? 0 };
      if (topic) body.topic = topic;
      if (parentId) body.parent_id = parentId;
      if (position !== undefined) body.position = position;
      if (nsfw !== undefined) body.nsfw = nsfw;
      if (bitrate !== undefined) body.bitrate = bitrate;
      if (userLimit !== undefined) body.user_limit = userLimit;
      if (rateLimitPerUser !== undefined)
        body.rate_limit_per_user = rateLimitPerUser;
      return apiRequest(botToken, "POST", `/guilds/${guildId}/channels`, body);
    },
  });

  rl.registerAction("channel.get", {
    access: "read",
    description: "Get a channel by ID",
    inputSchema: {
      channelId: { type: "string", required: true, description: "Channel ID" },
    },
    async execute(input, ctx) {
      const { botToken } = getConn(ctx);
      return apiRequest(
        botToken,
        "GET",
        `/channels/${(input as { channelId: string }).channelId}`,
      );
    },
  });

  rl.registerAction("channel.list", {
    access: "read",
    description: "List all channels in the guild",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      filterType: {
        type: "array",
        required: false,
        description: "Filter by type numbers [0,2,4]",
      },
    },
    async execute(input, ctx) {
      const { botToken, guildId } = getConn(ctx);
      const { limit, filterType } = (input ?? {}) as Record<string, unknown>;
      let channels = (await apiRequest(
        botToken,
        "GET",
        `/guilds/${guildId}/channels`,
      )) as Array<Record<string, unknown>>;
      if (filterType && Array.isArray(filterType) && filterType.length > 0) {
        channels = channels.filter((c) =>
          (filterType as number[]).includes(c.type as number),
        );
      }
      if (limit) channels = channels.slice(0, limit as number);
      return channels;
    },
  });

  rl.registerAction("channel.update", {
    access: "write",
    description: "Update a channel",
    inputSchema: {
      channelId: { type: "string", required: true, description: "Channel ID" },
      name: { type: "string", required: false, description: "New name" },
      topic: { type: "string", required: false, description: "New topic" },
      parentId: {
        type: "string",
        required: false,
        description: "New category ID",
      },
      position: {
        type: "number",
        required: false,
        description: "New position",
      },
      nsfw: { type: "boolean", required: false, description: "NSFW flag" },
      bitrate: {
        type: "number",
        required: false,
        description: "Bitrate (voice)",
      },
      userLimit: {
        type: "number",
        required: false,
        description: "User limit (voice)",
      },
      rateLimitPerUser: {
        type: "number",
        required: false,
        description: "Slowmode seconds",
      },
    },
    async execute(input, ctx) {
      const { botToken } = getConn(ctx);
      const {
        channelId,
        name,
        topic,
        parentId,
        position,
        nsfw,
        bitrate,
        userLimit,
        rateLimitPerUser,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (topic !== undefined) body.topic = topic;
      if (parentId) body.parent_id = parentId;
      if (position !== undefined) body.position = position;
      if (nsfw !== undefined) body.nsfw = nsfw;
      if (bitrate !== undefined) body.bitrate = bitrate;
      if (userLimit !== undefined) body.user_limit = userLimit;
      if (rateLimitPerUser !== undefined)
        body.rate_limit_per_user = rateLimitPerUser;
      return apiRequest(botToken, "PATCH", `/channels/${channelId}`, body);
    },
  });

  rl.registerAction("channel.delete", {
    access: "write",
    description: "Delete a channel",
    inputSchema: {
      channelId: { type: "string", required: true, description: "Channel ID" },
    },
    async execute(input, ctx) {
      const { botToken } = getConn(ctx);
      return apiRequest(
        botToken,
        "DELETE",
        `/channels/${(input as { channelId: string }).channelId}`,
      );
    },
  });

  // ── Member ──────────────────────────────────────────

  rl.registerAction("member.list", {
    access: "read",
    description: "List members in the guild",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results (default: 100, max: 1000)",
      },
      after: {
        type: "string",
        required: false,
        description: "Fetch members after this user ID (pagination)",
      },
    },
    async execute(input, ctx) {
      const { botToken, guildId } = getConn(ctx);
      const { limit, after } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.limit = limit;
      if (after) qs.after = after;
      return apiRequest(
        botToken,
        "GET",
        `/guilds/${guildId}/members`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("member.addRole", {
    access: "write",
    description: "Add a role to a guild member",
    inputSchema: {
      userId: { type: "string", required: true, description: "User ID" },
      roleId: { type: "string", required: true, description: "Role ID" },
    },
    async execute(input, ctx) {
      const { botToken, guildId } = getConn(ctx);
      const { userId, roleId } = input as { userId: string; roleId: string };
      await apiRequest(
        botToken,
        "PUT",
        `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("member.removeRole", {
    access: "write",
    description: "Remove a role from a guild member",
    inputSchema: {
      userId: { type: "string", required: true, description: "User ID" },
      roleId: { type: "string", required: true, description: "Role ID" },
    },
    async execute(input, ctx) {
      const { botToken, guildId } = getConn(ctx);
      const { userId, roleId } = input as { userId: string; roleId: string };
      await apiRequest(
        botToken,
        "DELETE",
        `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
      );
      return { success: true };
    },
  });

  // ── Message ─────────────────────────────────────────

  rl.registerAction("message.send", {
    access: "write",
    description: "Send a message to a channel",
    inputSchema: {
      channelId: { type: "string", required: true, description: "Channel ID" },
      content: {
        type: "string",
        required: true,
        description: "Message content (up to 2000 chars)",
      },
      tts: { type: "boolean", required: false, description: "Text-to-speech" },
      replyTo: {
        type: "string",
        required: false,
        description: "Message ID to reply to",
      },
      embeds: {
        type: "array",
        required: false,
        description: "Array of embed objects",
      },
    },
    async execute(input, ctx) {
      const { botToken } = getConn(ctx);
      const { channelId, content, tts, replyTo, embeds } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { content };
      if (tts) body.tts = true;
      if (replyTo) body.message_reference = { message_id: replyTo };
      if (embeds) body.embeds = embeds;
      return apiRequest(
        botToken,
        "POST",
        `/channels/${channelId}/messages`,
        body,
      );
    },
  });

  rl.registerAction("message.get", {
    access: "read",
    description: "Get a message by ID",
    inputSchema: {
      channelId: { type: "string", required: true, description: "Channel ID" },
      messageId: { type: "string", required: true, description: "Message ID" },
    },
    async execute(input, ctx) {
      const { botToken } = getConn(ctx);
      const { channelId, messageId } = input as {
        channelId: string;
        messageId: string;
      };
      return apiRequest(
        botToken,
        "GET",
        `/channels/${channelId}/messages/${messageId}`,
      );
    },
  });

  rl.registerAction("message.list", {
    access: "read",
    description: "List messages in a channel",
    inputSchema: {
      channelId: { type: "string", required: true, description: "Channel ID" },
      limit: {
        type: "number",
        required: false,
        description: "Max results (default: 50, max: 100)",
      },
      before: {
        type: "string",
        required: false,
        description: "Get messages before this ID",
      },
      after: {
        type: "string",
        required: false,
        description: "Get messages after this ID",
      },
      around: {
        type: "string",
        required: false,
        description: "Get messages around this ID",
      },
    },
    async execute(input, ctx) {
      const { botToken } = getConn(ctx);
      const { channelId, limit, before, after, around } = (input ??
        {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.limit = limit;
      if (before) qs.before = before;
      if (after) qs.after = after;
      if (around) qs.around = around;
      return apiRequest(
        botToken,
        "GET",
        `/channels/${channelId}/messages`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("message.delete", {
    access: "write",
    description: "Delete a message",
    inputSchema: {
      channelId: { type: "string", required: true, description: "Channel ID" },
      messageId: { type: "string", required: true, description: "Message ID" },
    },
    async execute(input, ctx) {
      const { botToken } = getConn(ctx);
      const { channelId, messageId } = input as {
        channelId: string;
        messageId: string;
      };
      await apiRequest(
        botToken,
        "DELETE",
        `/channels/${channelId}/messages/${messageId}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("message.react", {
    access: "write",
    description: "Add a reaction to a message",
    inputSchema: {
      channelId: { type: "string", required: true, description: "Channel ID" },
      messageId: { type: "string", required: true, description: "Message ID" },
      emoji: {
        type: "string",
        required: true,
        description: "Emoji to react with (Unicode or name:id for custom)",
      },
    },
    async execute(input, ctx) {
      const { botToken } = getConn(ctx);
      const { channelId, messageId, emoji } = input as {
        channelId: string;
        messageId: string;
        emoji: string;
      };
      await apiRequest(
        botToken,
        "PUT",
        `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
      );
      return { success: true };
    },
  });
}
