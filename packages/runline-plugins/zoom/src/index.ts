import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.zoom.us/v2";

async function apiRequest(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (res.status === 204) return { success: true };
  if (!res.ok) throw new Error(`Zoom error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : { success: true };
}

export default function zoom(rl: RunlinePluginAPI) {
  rl.setName("zoom");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Zoom access token (JWT or OAuth2)",
      env: "ZOOM_ACCESS_TOKEN",
    },
  });
  const key = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.accessToken as string;

  rl.registerAction("meeting.create", {
    access: "write",
    description: "Create a Zoom meeting",
    inputSchema: {
      topic: { type: "string", required: true },
      type: {
        type: "number",
        required: false,
        description:
          "1=Instant, 2=Scheduled, 3=Recurring no fixed, 8=Recurring fixed",
      },
      startTime: {
        type: "string",
        required: false,
        description: "ISO 8601 datetime",
      },
      duration: {
        type: "number",
        required: false,
        description: "Duration in minutes",
      },
      timezone: { type: "string", required: false },
      password: { type: "string", required: false },
      agenda: { type: "string", required: false },
      settings: {
        type: "object",
        required: false,
        description: "Meeting settings object",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { topic: p.topic };
      if (p.type) body.type = p.type;
      if (p.startTime) body.start_time = p.startTime;
      if (p.duration) body.duration = p.duration;
      if (p.timezone) body.timezone = p.timezone;
      if (p.password) body.password = p.password;
      if (p.agenda) body.agenda = p.agenda;
      if (p.settings) body.settings = p.settings;
      return apiRequest(key(ctx), "POST", "/users/me/meetings", body);
    },
  });

  rl.registerAction("meeting.get", {
    access: "read",
    description: "Get a meeting by ID",
    inputSchema: { meetingId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        key(ctx),
        "GET",
        `/meetings/${(input as Record<string, unknown>).meetingId}`,
      );
    },
  });

  rl.registerAction("meeting.list", {
    access: "read",
    description: "List meetings for the authenticated user",
    inputSchema: {
      limit: { type: "number", required: false },
      type: {
        type: "string",
        required: false,
        description: "scheduled, live, upcoming",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.page_size = p.limit;
      if (p.type) qs.type = p.type;
      const data = (await apiRequest(
        key(ctx),
        "GET",
        "/users/me/meetings",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.meetings;
    },
  });

  rl.registerAction("meeting.update", {
    access: "write",
    description: "Update a meeting",
    inputSchema: {
      meetingId: { type: "string", required: true },
      topic: { type: "string", required: false },
      startTime: { type: "string", required: false },
      duration: { type: "number", required: false },
      timezone: { type: "string", required: false },
      password: { type: "string", required: false },
      agenda: { type: "string", required: false },
      settings: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const { meetingId, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.topic) body.topic = fields.topic;
      if (fields.startTime) body.start_time = fields.startTime;
      if (fields.duration) body.duration = fields.duration;
      if (fields.timezone) body.timezone = fields.timezone;
      if (fields.password) body.password = fields.password;
      if (fields.agenda) body.agenda = fields.agenda;
      if (fields.settings) body.settings = fields.settings;
      await apiRequest(key(ctx), "PATCH", `/meetings/${meetingId}`, body);
      return { success: true };
    },
  });

  rl.registerAction("meeting.delete", {
    access: "write",
    description: "Delete a meeting",
    inputSchema: { meetingId: { type: "string", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        key(ctx),
        "DELETE",
        `/meetings/${(input as Record<string, unknown>).meetingId}`,
      );
      return { success: true };
    },
  });
}
