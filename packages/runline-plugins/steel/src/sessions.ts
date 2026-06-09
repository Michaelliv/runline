import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { LIST_INPUT_SCHEMA, SESSION_OPTIONS_SCHEMA, api, apiKey, compactRecord } from "./shared.js";

export function registerSessionActions(rl: RunlinePluginAPI) {
  rl.registerAction("session.create", {
    description: "Create a Steel browser session. Returns session id, websocketUrl/CDP URL, debug/viewer URLs, and profile metadata when present.",
    inputSchema: t.Object(SESSION_OPTIONS_SCHEMA),
    async execute(input, ctx) {
      return api(ctx, "/v1/sessions", { method: "POST", body: compactRecord((input ?? {}) as Record<string, unknown>) });
    },
  });

  rl.registerAction("session.list", {
    description: "List Steel sessions.",
    inputSchema: t.Object(LIST_INPUT_SCHEMA),
    async execute(input, ctx) {
      return api(ctx, "/v1/sessions", { query: (input ?? {}) as Record<string, unknown> });
    },
  });

  rl.registerAction("session.get", {
    description: "Get a Steel session by ID.",
    inputSchema: t.Object({ id: t.String({ description: "Session ID" }) }),
    async execute(input, ctx) {
      return api(ctx, `/v1/sessions/${encodeURIComponent((input as { id: string }).id)}`);
    },
  });

  rl.registerAction("session.release", {
    description: "Release a Steel session when work is done.",
    inputSchema: t.Object({ id: t.String({ description: "Session ID" }) }),
    async execute(input, ctx) {
      return api(ctx, `/v1/sessions/${encodeURIComponent((input as { id: string }).id)}/release`, { method: "POST" });
    },
  });

  rl.registerAction("session.releaseAll", {
    description: "Release all live Steel sessions for the organization by listing sessions and releasing each live session individually.",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      const listed = await api(ctx, "/v1/sessions") as Record<string, unknown>;
      const sessions = Array.isArray(listed.sessions) ? listed.sessions as Record<string, unknown>[] : [];
      const live = sessions.filter((session) => session.status === "live" || session.status === "LIVE");
      const released = [];
      const failed = [];
      for (const session of live) {
        const id = String(session.id);
        try {
          released.push({ id, result: await api(ctx, `/v1/sessions/${encodeURIComponent(id)}/release`, { method: "POST" }) });
        } catch (error) {
          failed.push({ id, error: String((error as Error).message ?? error) });
        }
      }
      return { released, failed, count: released.length };
    },
  });

  rl.registerAction("session.context", {
    description: "Capture cookies/localStorage context from a live session. Treat output as sensitive auth material.",
    inputSchema: t.Object({ id: t.String({ description: "Session ID" }) }),
    async execute(input, ctx) {
      return api(ctx, `/v1/sessions/${encodeURIComponent((input as { id: string }).id)}/context`);
    },
  });

  rl.registerAction("session.traces", {
    description: "Fetch the Agent Traces timeline for a Steel session. Supports optional ISO startTime/endTime filters.",
    inputSchema: t.Object({
      id: t.String({ description: "Session ID" }),
      startTime: t.Optional(t.String({ description: "ISO timestamp lower bound" })),
      endTime: t.Optional(t.String({ description: "ISO timestamp upper bound" })),
    }),
    async execute(input, ctx) {
      const { id, ...query } = input as Record<string, unknown>;
      return api(ctx, `/v1/sessions/${encodeURIComponent(String(id))}/agent-traces`, { query });
    },
  });

  rl.registerAction("session.computer", {
    description: "Execute a Steel computer-use action against a live session. Useful for model-native computer-use loops; pass actions such as take_screenshot, click_mouse, type_text, press_key, scroll, or drag_mouse.",
    inputSchema: t.Object({
      id: t.String({ description: "Session ID" }),
      action: t.String({ description: "Steel computer action, e.g. take_screenshot, click_mouse, type_text, press_key, scroll, drag_mouse" }),
      button: t.Optional(t.String({ description: "Mouse button for click actions" })),
      coordinates: t.Optional(t.Array(t.Number(), { description: "[x, y] pixel coordinates" })),
      text: t.Optional(t.String({ description: "Text for type_text or key for press_key" })),
      keys: t.Optional(t.Array(t.String(), { description: "Keys for keyboard actions when supported" })),
      deltaX: t.Optional(t.Number({ description: "Horizontal scroll delta" })),
      deltaY: t.Optional(t.Number({ description: "Vertical scroll delta" })),
      path: t.Optional(t.Array(t.Any(), { description: "Drag path points when supported" })),
      screenshot: t.Optional(t.Boolean({ description: "Return a screenshot after the action" })),
    }),
    async execute(input, ctx) {
      const { id, deltaX, deltaY, ...body } = input as Record<string, unknown>;
      const payload = compactRecord({ ...body, delta_x: deltaX, delta_y: deltaY });
      return api(ctx, `/v1/sessions/${encodeURIComponent(String(id))}/computer`, { method: "POST", body: payload });
    },
  });

  rl.registerAction("session.events", {
    description: "Fetch legacy recorded session events for replay tooling.",
    inputSchema: t.Object({ id: t.String({ description: "Session ID" }) }),
    async execute(input, ctx) {
      return api(ctx, `/v1/sessions/${encodeURIComponent((input as { id: string }).id)}/events`);
    },
  });

  rl.registerAction("session.hls", {
    description: "Fetch the HLS playlist for a recorded headful Steel session.",
    inputSchema: t.Object({ id: t.String({ description: "Session ID" }) }),
    async execute(input, ctx) {
      return api(ctx, `/v1/sessions/${encodeURIComponent((input as { id: string }).id)}/hls`);
    },
  });

  rl.registerAction("session.cdpUrl", {
    description: "Build a Playwright/Puppeteer CDP URL for a Steel session using the configured API key.",
    inputSchema: t.Object({ id: t.String({ description: "Session ID" }), websocketUrl: t.Optional(t.String({ description: "Optional websocketUrl returned by session.create. If omitted, uses wss://connect.steel.dev with sessionId." })) }),
    async execute(input, ctx) {
      const { id, websocketUrl } = input as { id: string; websocketUrl?: string };
      const key = encodeURIComponent(apiKey(ctx));
      if (websocketUrl) {
        const sep = websocketUrl.includes("?") ? "&" : "?";
        return { cdpUrl: `${websocketUrl}${sep}apiKey=${key}` };
      }
      return { cdpUrl: `wss://connect.steel.dev?apiKey=${key}&sessionId=${encodeURIComponent(id)}` };
    },
  });
}
