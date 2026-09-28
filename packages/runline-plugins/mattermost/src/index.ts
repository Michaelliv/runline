import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { mattermostCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: unknown,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, mattermostCredential, "mattermost", {
    target: "api",
    path,
    method,
    query,
    ...(body !== undefined && method !== "GET" && method !== "DELETE"
      ? { json: body }
      : {}),
  });
}

async function paginateAll(
  ctx: ActionContext,
  path: string,
  query: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  query.page = 0;
  query.per_page = 100;
  let data: unknown[];
  do {
    data = (await apiRequest(ctx, "GET", path, undefined, query)) as unknown[];
    all.push(...data);
    (query.page as number)++;
  } while (data.length > 0);
  return all;
}

export default function mattermost(rl: RunlinePluginAPI) {
  rl.setName("mattermost");
  rl.setVersion("0.1.0");
  rl.setCredential(mattermostCredential);

  rl.setConnectionSchema({
    baseUrl: {
      type: "string",
      required: true,
      description:
        "Mattermost server URL (e.g. https://mattermost.example.com)",
      env: "MATTERMOST_URL",
    },
    accessToken: {
      type: "string",
      required: true,
      description: "Personal access token or bot token",
      env: "MATTERMOST_TOKEN",
    },
  });

  // ── Channel ─────────────────────────────────────────

  rl.registerAction("channel.create", {
    access: "write",
    description: "Create a channel",
    inputSchema: {
      teamId: { type: "string", required: true },
      displayName: {
        type: "string",
        required: true,
        description: "Display name",
      },
      name: {
        type: "string",
        required: true,
        description: "URL-safe channel name",
      },
      type: {
        type: "string",
        required: true,
        description: "'public' or 'private'",
      },
    },
    async execute(input, ctx) {
      const { teamId, displayName, name, type } = input as Record<
        string,
        unknown
      >;
      return apiRequest(ctx, "POST", "channels", {
        team_id: teamId,
        display_name: displayName,
        name,
        type: type === "public" ? "O" : "P",
      });
    },
  });

  rl.registerAction("channel.delete", {
    access: "write",
    description: "Delete (archive) a channel",
    inputSchema: { channelId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "DELETE",
        `channels/${pathSegment((input as { channelId: string }).channelId)}`,
      );
    },
  });

  rl.registerAction("channel.addUser", {
    access: "write",
    description: "Add a user to a channel",
    inputSchema: {
      channelId: { type: "string", required: true },
      userId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { channelId, userId } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "POST",
        `channels/${pathSegment(channelId)}/members`,
        {
          user_id: userId,
        },
      );
    },
  });

  rl.registerAction("channel.members", {
    access: "read",
    description: "List members of a channel",
    inputSchema: {
      channelId: { type: "string", required: true },
      limit: { type: "number", required: false },
      resolveData: {
        type: "boolean",
        required: false,
        description: "Resolve user IDs to full user objects",
      },
    },
    async execute(input, ctx) {
      const { channelId, limit, resolveData } = (input ?? {}) as Record<
        string,
        unknown
      >;
      let data: unknown[];
      if (limit) {
        data = (await apiRequest(
          ctx,
          "GET",
          `channels/${pathSegment(channelId)}/members`,
          undefined,
          { per_page: limit },
        )) as unknown[];
      } else {
        data = await paginateAll(
          ctx,
          `channels/${pathSegment(channelId)}/members`,
        );
      }
      if (resolveData && data.length > 0) {
        const userIds = (data as Array<Record<string, unknown>>).map(
          (m) => m.user_id as string,
        );
        return apiRequest(ctx, "POST", "users/ids", userIds);
      }
      return data;
    },
  });

  rl.registerAction("channel.restore", {
    access: "write",
    description: "Restore (unarchive) a channel",
    inputSchema: { channelId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "POST",
        `channels/${pathSegment((input as { channelId: string }).channelId)}/restore`,
      );
    },
  });

  rl.registerAction("channel.search", {
    access: "read",
    description: "Search channels in a team",
    inputSchema: {
      teamId: { type: "string", required: true },
      term: { type: "string", required: true, description: "Search term" },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const { teamId, term, limit } = input as Record<string, unknown>;
      let data = (await apiRequest(
        ctx,
        "POST",
        `teams/${pathSegment(teamId)}/channels/search`,
        { term },
      )) as unknown[];
      if (limit) data = data.slice(0, limit as number);
      return data;
    },
  });

  rl.registerAction("channel.statistics", {
    access: "read",
    description: "Get channel statistics",
    inputSchema: { channelId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `channels/${pathSegment((input as { channelId: string }).channelId)}/stats`,
      );
    },
  });

  // ── Message ─────────────────────────────────────────

  rl.registerAction("message.post", {
    access: "write",
    description: "Post a message to a channel",
    inputSchema: {
      channelId: { type: "string", required: true },
      message: { type: "string", required: true },
      attachments: {
        type: "array",
        required: false,
        description: "Array of Mattermost attachment objects",
      },
      rootId: {
        type: "string",
        required: false,
        description: "Post ID to reply to (thread)",
      },
    },
    async execute(input, ctx) {
      const { channelId, message, attachments, rootId } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { channel_id: channelId, message };
      if (attachments) body.props = { attachments };
      if (rootId) body.root_id = rootId;
      return apiRequest(ctx, "POST", "posts", body);
    },
  });

  rl.registerAction("message.delete", {
    access: "write",
    description: "Delete a message (post)",
    inputSchema: { postId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "DELETE",
        `posts/${pathSegment((input as { postId: string }).postId)}`,
      );
    },
  });

  rl.registerAction("message.postEphemeral", {
    access: "write",
    description: "Post an ephemeral message (visible only to one user)",
    inputSchema: {
      channelId: { type: "string", required: true },
      userId: {
        type: "string",
        required: true,
        description: "User who will see the message",
      },
      message: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { channelId, userId, message } = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", "posts/ephemeral", {
        user_id: userId,
        post: { channel_id: channelId, message },
      });
    },
  });

  // ── Reaction ────────────────────────────────────────

  rl.registerAction("reaction.create", {
    access: "write",
    description: "Add a reaction to a post",
    inputSchema: {
      userId: { type: "string", required: true },
      postId: { type: "string", required: true },
      emojiName: {
        type: "string",
        required: true,
        description: "Emoji name without colons (e.g. 'thumbsup')",
      },
    },
    async execute(input, ctx) {
      const { userId, postId, emojiName } = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", "reactions", {
        user_id: userId,
        post_id: postId,
        emoji_name: (emojiName as string).replace(/:/g, ""),
        create_at: Date.now(),
      });
    },
  });

  rl.registerAction("reaction.delete", {
    access: "write",
    description: "Remove a reaction from a post",
    inputSchema: {
      userId: { type: "string", required: true },
      postId: { type: "string", required: true },
      emojiName: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { userId, postId, emojiName } = input as Record<string, unknown>;
      const name = (emojiName as string).replace(/:/g, "");
      return apiRequest(
        ctx,
        "DELETE",
        `users/${pathSegment(userId)}/posts/${pathSegment(postId)}/reactions/${pathSegment(name)}`,
      );
    },
  });

  rl.registerAction("reaction.list", {
    access: "read",
    description: "List reactions on a post",
    inputSchema: {
      postId: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const { postId, limit } = input as Record<string, unknown>;
      let data = (await apiRequest(
        ctx,
        "GET",
        `posts/${pathSegment(postId)}/reactions`,
      )) as unknown[];
      if (data === null) return [];
      if (limit) data = data.slice(0, limit as number);
      return data;
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.create", {
    access: "write",
    description: "Create a user",
    inputSchema: {
      username: { type: "string", required: true },
      authService: {
        type: "string",
        required: true,
        description: "'email' for email/password, or an SSO service name",
      },
      email: {
        type: "string",
        required: false,
        description: "Required if authService is 'email'",
      },
      password: {
        type: "string",
        required: false,
        description: "Required if authService is 'email'",
      },
      authData: {
        type: "string",
        required: false,
        description: "Required if authService is not 'email'",
      },
      additionalFields: {
        type: "object",
        required: false,
        description: "first_name, last_name, nickname, locale, position, etc.",
      },
    },
    async execute(input, ctx) {
      const {
        username,
        authService,
        email,
        password,
        authData,
        additionalFields,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        username,
        auth_service: authService,
      };
      if (authService === "email") {
        body.email = email;
        body.password = password;
      } else {
        body.auth_data = authData;
      }
      if (additionalFields) Object.assign(body, additionalFields);
      return apiRequest(ctx, "POST", "users", body);
    },
  });

  rl.registerAction("user.deactivate", {
    access: "write",
    description: "Deactivate (delete) a user",
    inputSchema: { userId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "DELETE",
        `users/${pathSegment((input as { userId: string }).userId)}`,
      );
    },
  });

  rl.registerAction("user.list", {
    access: "read",
    description: "List users",
    inputSchema: {
      limit: { type: "number", required: false },
      inTeam: {
        type: "string",
        required: false,
        description: "Filter by team ID",
      },
      notInTeam: { type: "string", required: false },
      inChannel: {
        type: "string",
        required: false,
        description: "Filter by channel ID",
      },
      notInChannel: { type: "string", required: false },
      sort: {
        type: "string",
        required: false,
        description: "last_activity_at, created_at, username, status",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.inTeam) qs.in_team = p.inTeam;
      if (p.notInTeam) qs.not_in_team = p.notInTeam;
      if (p.inChannel) qs.in_channel = p.inChannel;
      if (p.notInChannel) qs.not_in_channel = p.notInChannel;
      if (p.sort && p.sort !== "username") qs.sort = p.sort;
      if (p.limit) {
        qs.per_page = p.limit;
        return apiRequest(ctx, "GET", "users", undefined, qs);
      }
      return paginateAll(ctx, "users", qs);
    },
  });

  rl.registerAction("user.getByEmail", {
    access: "read",
    description: "Get a user by email",
    inputSchema: { email: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `users/email/${pathSegment((input as { email: string }).email)}`,
      );
    },
  });

  rl.registerAction("user.getByIds", {
    access: "read",
    description: "Get users by IDs",
    inputSchema: {
      userIds: {
        type: "array",
        required: true,
        description: "Array of user IDs",
      },
      since: {
        type: "string",
        required: false,
        description: "ISO datetime — only return users updated since",
      },
    },
    async execute(input, ctx) {
      const { userIds, since } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (since) qs.since = new Date(since as string).getTime();
      return apiRequest(ctx, "POST", "users/ids", userIds, qs);
    },
  });

  rl.registerAction("user.invite", {
    access: "write",
    description: "Invite users to a team by email",
    inputSchema: {
      teamId: { type: "string", required: true },
      emails: {
        type: "array",
        required: true,
        description: "Array of email addresses",
      },
    },
    async execute(input, ctx) {
      const { teamId, emails } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "POST",
        `teams/${pathSegment(teamId)}/invite/email`,
        emails,
      );
    },
  });
}
