import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  homeserver: string,
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${homeserver}/_matrix/client/r0${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null && v !== "")
        url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  )
    opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok)
    throw new Error(`Matrix API error ${res.status}: ${await res.text()}`);
  return res.json();
}

function generateTxnId(): string {
  return crypto.randomUUID();
}

export default function matrix(rl: RunlinePluginAPI) {
  rl.setName("matrix");
  rl.setVersion("0.1.0");

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

  const conn = (ctx: { connection: { config: Record<string, unknown> } }) => ({
    homeserver: (ctx.connection.config.homeserverUrl as string).replace(
      /\/$/,
      "",
    ),
    token: ctx.connection.config.accessToken as string,
  });

  // ── Account ─────────────────────────────────────────

  rl.registerAction("account.me", {
    access: "read",
    description: "Get info about the authenticated user",
    async execute(_input, ctx) {
      const { homeserver, token } = conn(ctx);
      return apiRequest(homeserver, token, "GET", "/account/whoami");
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
      const { homeserver, token } = conn(ctx);
      const body: Record<string, unknown> = { name, preset };
      if (roomAlias) body.room_alias_name = roomAlias;
      return apiRequest(homeserver, token, "POST", "/createRoom", body);
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
      const { homeserver, token } = conn(ctx);
      return apiRequest(
        homeserver,
        token,
        "POST",
        `/rooms/${encodeURIComponent((input as { roomIdOrAlias: string }).roomIdOrAlias)}/join`,
      );
    },
  });

  rl.registerAction("room.leave", {
    access: "write",
    description: "Leave a room",
    inputSchema: { roomId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { homeserver, token } = conn(ctx);
      return apiRequest(
        homeserver,
        token,
        "POST",
        `/rooms/${encodeURIComponent((input as { roomId: string }).roomId)}/leave`,
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
      const { homeserver, token } = conn(ctx);
      return apiRequest(
        homeserver,
        token,
        "POST",
        `/rooms/${encodeURIComponent(roomId as string)}/invite`,
        { user_id: userId },
      );
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
      const { homeserver, token } = conn(ctx);
      const body: Record<string, unknown> = { user_id: userId };
      if (reason) body.reason = reason;
      return apiRequest(
        homeserver,
        token,
        "POST",
        `/rooms/${encodeURIComponent(roomId as string)}/kick`,
        body,
      );
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
      const { homeserver, token } = conn(ctx);
      const body: Record<string, unknown> = {
        msgtype: messageType,
        body: text,
      };
      if (messageFormat === "org.matrix.custom.html") {
        body.format = messageFormat;
        body.formatted_body = text;
        body.body = fallbackText || text;
      }
      const txnId = generateTxnId();
      return apiRequest(
        homeserver,
        token,
        "PUT",
        `/rooms/${encodeURIComponent(roomId as string)}/send/m.room.message/${txnId}`,
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
      const { homeserver, token } = conn(ctx);

      if (limit) {
        const qs: Record<string, unknown> = { dir: "b", limit };
        if (filter) qs.filter = filter;
        const data = (await apiRequest(
          homeserver,
          token,
          "GET",
          `/rooms/${encodeURIComponent(roomId as string)}/messages`,
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
          homeserver,
          token,
          "GET",
          `/rooms/${encodeURIComponent(roomId as string)}/messages`,
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
      const { homeserver, token } = conn(ctx);
      return apiRequest(
        homeserver,
        token,
        "GET",
        `/rooms/${encodeURIComponent(roomId as string)}/event/${encodeURIComponent(eventId as string)}`,
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
      const { homeserver, token } = conn(ctx);
      const qs: Record<string, unknown> = {};
      if (membership) qs.membership = membership;
      if (notMembership) qs.not_membership = notMembership;
      const data = (await apiRequest(
        homeserver,
        token,
        "GET",
        `/rooms/${encodeURIComponent(roomId as string)}/members`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.chunk;
    },
  });
}
