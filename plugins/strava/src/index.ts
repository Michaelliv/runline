import type { RunlinePluginAPI } from "runline";

const BASE = "https://www.strava.com/api/v3";

async function apiRequest(
  token: string, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body && Object.keys(body).length > 0) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) { if (v !== undefined && v !== null) form.set(k, String(v)); }
    init.body = form;
    (init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded";
  }
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Strava error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function strava(rl: RunlinePluginAPI) {
  rl.setName("strava");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "Strava OAuth2 access token", env: "STRAVA_ACCESS_TOKEN" },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.accessToken as string;

  rl.registerAction("activity.create", {
    description: "Create an activity",
    inputSchema: {
      name: { type: "string", required: true },
      sportType: { type: "string", required: true, description: "e.g. Run, Ride, Swim, Hike" },
      startDateLocal: { type: "string", required: true, description: "ISO 8601 start time" },
      elapsedTime: { type: "number", required: true, description: "Duration in seconds" },
      description: { type: "string", required: false },
      distance: { type: "number", required: false, description: "Distance in meters" },
      trainer: { type: "boolean", required: false },
      commute: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        name: p.name, sport_type: p.sportType,
        start_date_local: new Date(p.startDateLocal as string).toISOString(),
        elapsed_time: p.elapsedTime,
      };
      if (p.description) body.description = p.description;
      if (p.distance) body.distance = p.distance;
      if (p.trainer) body.trainer = 1;
      if (p.commute) body.commute = 1;
      return apiRequest(key(ctx), "POST", "/activities", body);
    },
  });

  rl.registerAction("activity.get", {
    description: "Get an activity by ID",
    inputSchema: { activityId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(key(ctx), "GET", `/activities/${(input as Record<string, unknown>).activityId}`);
    },
  });

  rl.registerAction("activity.list", {
    description: "List the authenticated athlete's activities",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit) qs.per_page = (input as Record<string, unknown>).limit;
      return apiRequest(key(ctx), "GET", "/activities", undefined, qs);
    },
  });

  rl.registerAction("activity.update", {
    description: "Update an activity",
    inputSchema: {
      activityId: { type: "string", required: true },
      name: { type: "string", required: false },
      sportType: { type: "string", required: false },
      description: { type: "string", required: false },
      trainer: { type: "boolean", required: false },
      commute: { type: "boolean", required: false },
      gearId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { activityId, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.name) body.name = fields.name;
      if (fields.sportType) body.sport_type = fields.sportType;
      if (fields.description) body.description = fields.description;
      if (fields.trainer !== undefined) body.trainer = fields.trainer;
      if (fields.commute !== undefined) body.commute = fields.commute;
      if (fields.gearId) body.gear_id = fields.gearId;
      return apiRequest(key(ctx), "PUT", `/activities/${activityId}`, body);
    },
  });

  for (const sub of [
    { name: "getLaps", path: "laps", description: "Get laps for an activity" },
    { name: "getZones", path: "zones", description: "Get zones for an activity" },
    { name: "getKudos", path: "kudos", description: "Get kudos for an activity" },
    { name: "getComments", path: "comments", description: "Get comments for an activity" },
  ]) {
    rl.registerAction(`activity.${sub.name}`, {
      description: sub.description,
      inputSchema: { activityId: { type: "string", required: true }, limit: { type: "number", required: false } },
      async execute(input, ctx) {
        const p = input as Record<string, unknown>;
        const data = (await apiRequest(key(ctx), "GET", `/activities/${p.activityId}/${sub.path}`)) as unknown[];
        if (p.limit) return data.slice(0, p.limit as number);
        return data;
      },
    });
  }

  rl.registerAction("activity.getStreams", {
    description: "Get activity streams (time-series data)",
    inputSchema: {
      activityId: { type: "string", required: true },
      keys: { type: "string", required: true, description: "Comma-separated stream types: time, distance, latlng, altitude, heartrate, cadence, watts, temp, moving, grade_smooth" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(key(ctx), "GET", `/activities/${p.activityId}/streams`, undefined, { keys: p.keys, key_by_type: "true" });
    },
  });
}
