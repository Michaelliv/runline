import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { matrixCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, matrixCredential, "matrix", {
    target: "api",
    path,
    method,
    query,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

export default function matrix(rl: RunlinePluginAPI) {
  rl.setName("matrix");
  rl.setVersion("0.1.0");
  rl.setCredential(matrixCredential);

  rl.setConnectionSchema({
    homeserverUrl: {
      type: "string",
      required: true,
      description: "Matrix homeserver URL (e.g. https://matrix.org)",
      env: "MATRIX_HOMESERVER_URL",
    },
    accessToken: {
      type: "string",
      required: true,
      description: "Matrix access token",
      env: "MATRIX_ACCESS_TOKEN",
    },
  });

  // ── Account ─────────────────────────────────────────

  rl.registerAction("account.me", {
    access: "read",
    description: "Get info about the authenticated user",
    async execute(_input, ctx) {
      return apiRequest(ctx, "GET", "account/whoami");
    },
  });

  // ── Room ────────────────────────────────────────────

  rl.registerAction("room.create", {
    access: "write",
    description: "Create a new room",
    inputSchema: {
      name: { type: "string", required: true, description: "Room name" },
      preset: {
        type: "string",
        required: true,
        description: "private_chat, public_chat, or trusted_private_chat",
      },
      roomAlias: {
        type: "string",
        required: false,
        description: "Local part of room alias (without # or :server)",
      },
    },
    async execute(input, ctx) {
      const { name, preset, roomAlias } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name, preset };
      if (roomAlias) body.room_alias_name = roomAlias;
      return apiRequest(ctx, "POST", "createRoom", body);
    },
  });

  rl.registerAction("room.join", {
    access: "write",
    description: "Join a room",
    inputSchema: {
      roomIdOrAlias: {
        type: "string",
        required: true,
        description: "Room ID (!xxx:server) or alias (#xxx:server)",
      },
    },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "POST",
        `rooms/${pathSegment((input as { roomIdOrAlias: string }).roomIdOrAlias)}/join`,
      );
    },
  });

  rl.registerAction("room.leave", {
    access: "write",
    description: "Leave a room",
    inputSchema: { roomId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "POST",
        `rooms/${pathSegment((input as { roomId: string }).roomId)}/leave`,
      );
    },
  });

  rl.registerAction("room.invite", {
    access: "write",
    description: "Invite a user to a room",
    inputSchema: {
      roomId: { type: "string", required: true },
      userId: {
        type: "string",
        required: true,
        description: "Matrix user ID (@user:server)",
      },
    },
    async execute(input, ctx) {
      const { roomId, userId } = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", `rooms/${pathSegment(roomId)}/invite`, {
        user_id: userId,
      });
    },
  });

  rl.registerAction("room.kick", {
    access: "write",
    description: "Kick a user from a room",
    inputSchema: {
      roomId: { type: "string", required: true },
      userId: { type: "string", required: true },
      reason: {
        type: "string",
        required: false,
        description: "Reason for kicking",
      },
    },
    async execute(input, ctx) {
      const { roomId, userId, reason } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { user_id: userId };
      if (reason) body.reason = reason;
      return apiRequest(ctx, "POST", `rooms/${pathSegment(roomId)}/kick`, body);
    },
  });

  // ── Message ─────────────────────────────────────────

  rl.registerAction("message.create", {
    access: "write",
    description: "Send a message to a room",
    inputSchema: {
      roomId: { type: "string", required: true },
      text: {
        type: "string",
        required: true,
        description:
          "Message text (or HTML if format is org.matrix.custom.html)",
      },
      messageType: {
        type: "string",
        required: false,
        description: "m.text (default), m.notice, m.emote",
      },
      messageFormat: {
        type: "string",
        required: false,
        description: "org.matrix.custom.html for HTML messages",
      },
      fallbackText: {
        type: "string",
        required: false,
        description: "Plain text fallback for HTML messages",
      },
    },
    async execute(input, ctx) {
      const {
        roomId,
        text,
        messageType = "m.text",
        messageFormat,
        fallbackText,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        msgtype: messageType,
        body: text,
      };
      if (messageFormat === "org.matrix.custom.html") {
        body.format = messageFormat;
        body.formatted_body = text;
        body.body = fallbackText || text;
      }
      return apiRequest(
        ctx,
        "PUT",
        `rooms/${pathSegment(roomId)}/send/m.room.message/${crypto.randomUUID()}`,
        body,
      );
    },
  });

  rl.registerAction("message.list", {
    access: "read",
    description: "Get messages from a room (newest first)",
    inputSchema: {
      roomId: { type: "string", required: true },
      limit: {
        type: "number",
        required: false,
        description: "Max messages to return",
      },
      filter: {
        type: "string",
        required: false,
        description: "JSON filter string",
      },
    },
    async execute(input, ctx) {
      const { roomId, limit, filter } = (input ?? {}) as Record<
        string,
        unknown
      >;

      if (limit) {
        const qs: Record<string, unknown> = { dir: "b", limit };
        if (filter) qs.filter = filter;
        const data = (await apiRequest(
          ctx,
          "GET",
          `rooms/${pathSegment(roomId)}/messages`,
          undefined,
          qs,
        )) as Record<string, unknown>;
        return data.chunk;
      }

      // Paginate all
      const all: unknown[] = [];
      let from: string | undefined;
      let chunk: unknown[];
      do {
        const qs: Record<string, unknown> = { dir: "b" };
        if (from) qs.from = from;
        if (filter) qs.filter = filter;
        const data = (await apiRequest(
          ctx,
          "GET",
          `rooms/${pathSegment(roomId)}/messages`,
          undefined,
          qs,
        )) as Record<string, unknown>;
        chunk = data.chunk as unknown[];
        all.push(...chunk);
        from = data.end as string;
      } while (chunk.length > 0);
      return all;
    },
  });

  // ── Event ───────────────────────────────────────────

  rl.registerAction("event.get", {
    access: "read",
    description: "Get a single event from a room",
    inputSchema: {
      roomId: { type: "string", required: true },
      eventId: {
        type: "string",
        required: true,
        description: "Event ID ($xxx)",
      },
    },
    async execute(input, ctx) {
      const { roomId, eventId } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `rooms/${pathSegment(roomId)}/event/${pathSegment(eventId)}`,
      );
    },
  });

  // ── Room Member ─────────────────────────────────────

  rl.registerAction("roomMember.list", {
    access: "read",
    description: "List members of a room",
    inputSchema: {
      roomId: { type: "string", required: true },
      membership: {
        type: "string",
        required: false,
        description: "Filter: join, invite, leave, ban, knock",
      },
      notMembership: {
        type: "string",
        required: false,
        description: "Exclude membership type",
      },
    },
    async execute(input, ctx) {
      const { roomId, membership, notMembership } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (membership) qs.membership = membership;
      if (notMembership) qs.not_membership = notMembership;
      const data = (await apiRequest(
        ctx,
        "GET",
        `rooms/${pathSegment(roomId)}/members`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.chunk;
    },
  });
}
