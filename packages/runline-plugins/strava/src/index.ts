import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { stravaCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  let form: string | undefined;
  if (body && Object.keys(body).length > 0) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    form = params.toString();
  }
  return credentialJson(ctx, stravaCredential, "strava", {
    target: "api",
    path,
    method,
    query: qs,
    ...(form !== undefined
      ? {
          body: form,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      : {}),
  });
}

export default function strava(rl: RunlinePluginAPI) {
  rl.setName("strava");
  rl.setVersion("0.1.0");
  rl.setCredential(stravaCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Strava OAuth2 access token",
      env: "STRAVA_ACCESS_TOKEN",
    },
  });

  rl.registerAction("activity.create", {
    access: "write",
    description: "Create an activity",
    inputSchema: {
      name: { type: "string", required: true },
      sportType: {
        type: "string",
        required: true,
        description: "e.g. Run, Ride, Swim, Hike",
      },
      startDateLocal: {
        type: "string",
        required: true,
        description: "ISO 8601 start time",
      },
      elapsedTime: {
        type: "number",
        required: true,
        description: "Duration in seconds",
      },
      description: { type: "string", required: false },
      distance: {
        type: "number",
        required: false,
        description: "Distance in meters",
      },
      trainer: { type: "boolean", required: false },
      commute: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        name: p.name,
        sport_type: p.sportType,
        start_date_local: new Date(p.startDateLocal as string).toISOString(),
        elapsed_time: p.elapsedTime,
      };
      if (p.description) body.description = p.description;
      if (p.distance) body.distance = p.distance;
      if (p.trainer) body.trainer = 1;
      if (p.commute) body.commute = 1;
      return apiRequest(ctx, "POST", "activities", body);
    },
  });

  rl.registerAction("activity.get", {
    access: "read",
    description: "Get an activity by ID",
    inputSchema: { activityId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `activities/${seg((input as Record<string, unknown>).activityId)}`,
      );
    },
  });

  rl.registerAction("activity.list", {
    access: "read",
    description: "List the authenticated athlete's activities",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit)
        qs.per_page = (input as Record<string, unknown>).limit;
      return apiRequest(ctx, "GET", "activities", undefined, qs);
    },
  });

  rl.registerAction("activity.update", {
    access: "write",
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
      return apiRequest(ctx, "PUT", `activities/${seg(activityId)}`, body);
    },
  });

  for (const sub of [
    { name: "getLaps", path: "laps", description: "Get laps for an activity" },
    {
      name: "getZones",
      path: "zones",
      description: "Get zones for an activity",
    },
    {
      name: "getKudos",
      path: "kudos",
      description: "Get kudos for an activity",
    },
    {
      name: "getComments",
      path: "comments",
      description: "Get comments for an activity",
    },
  ]) {
    rl.registerAction(`activity.${sub.name}`, {
      access: "read",
      description: sub.description,
      inputSchema: {
        activityId: { type: "string", required: true },
        limit: { type: "number", required: false },
      },
      async execute(input, ctx) {
        const p = input as Record<string, unknown>;
        const data = (await apiRequest(
          ctx,
          "GET",
          `activities/${seg(p.activityId)}/${sub.path}`,
        )) as unknown[];
        if (p.limit) return data.slice(0, p.limit as number);
        return data;
      },
    });
  }

  rl.registerAction("activity.getStreams", {
    access: "read",
    description: "Get activity streams (time-series data)",
    inputSchema: {
      activityId: { type: "string", required: true },
      keys: {
        type: "string",
        required: true,
        description:
          "Comma-separated stream types: time, distance, latlng, altitude, heartrate, cadence, watts, temp, moving, grade_smooth",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `activities/${seg(p.activityId)}/streams`,
        undefined,
        { keys: p.keys, key_by_type: "true" },
      );
    },
  });
}
