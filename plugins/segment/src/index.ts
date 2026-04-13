import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.segment.io/v1";

async function apiRequest(writeKey: string, endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${writeKey}:`),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Segment error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function segment(rl: RunlinePluginAPI) {
  rl.setName("segment");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    writeKey: { type: "string", required: true, description: "Segment source write key", env: "SEGMENT_WRITE_KEY" },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.writeKey as string;

  rl.registerAction("identify.create", {
    description: "Identify a user (tie user to traits)",
    inputSchema: {
      userId: { type: "string", required: false, description: "User ID (or anonymousId will be generated)" },
      anonymousId: { type: "string", required: false },
      traits: { type: "object", required: false, description: "User traits key-value pairs" },
      context: { type: "object", required: false },
      integrations: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.userId) body.userId = p.userId; else body.anonymousId = p.anonymousId ?? crypto.randomUUID();
      if (p.traits) body.traits = p.traits;
      if (p.context) body.context = p.context;
      if (p.integrations) body.integrations = p.integrations;
      return apiRequest(key(ctx), "/identify", body);
    },
  });

  rl.registerAction("track.event", {
    description: "Track an event",
    inputSchema: {
      event: { type: "string", required: true, description: "Event name" },
      userId: { type: "string", required: false },
      anonymousId: { type: "string", required: false },
      properties: { type: "object", required: false, description: "Event properties" },
      context: { type: "object", required: false },
      integrations: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { event: p.event };
      if (p.userId) body.userId = p.userId; else body.anonymousId = p.anonymousId ?? crypto.randomUUID();
      if (p.properties) body.properties = p.properties;
      if (p.context) body.context = p.context;
      if (p.integrations) body.integrations = p.integrations;
      return apiRequest(key(ctx), "/track", body);
    },
  });

  rl.registerAction("track.page", {
    description: "Track a page view",
    inputSchema: {
      name: { type: "string", required: true, description: "Page name" },
      userId: { type: "string", required: false },
      anonymousId: { type: "string", required: false },
      properties: { type: "object", required: false },
      context: { type: "object", required: false },
      integrations: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name };
      if (p.userId) body.userId = p.userId; else body.anonymousId = p.anonymousId ?? crypto.randomUUID();
      if (p.properties) body.properties = p.properties;
      if (p.context) body.context = p.context;
      if (p.integrations) body.integrations = p.integrations;
      return apiRequest(key(ctx), "/page", body);
    },
  });

  rl.registerAction("group.add", {
    description: "Associate a user with a group",
    inputSchema: {
      groupId: { type: "string", required: true },
      userId: { type: "string", required: false },
      anonymousId: { type: "string", required: false },
      traits: { type: "object", required: false, description: "Group traits" },
      context: { type: "object", required: false },
      integrations: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { groupId: p.groupId };
      if (p.userId) body.userId = p.userId; else body.anonymousId = p.anonymousId ?? crypto.randomUUID();
      if (p.traits) body.traits = p.traits;
      if (p.context) body.context = p.context;
      if (p.integrations) body.integrations = p.integrations;
      return apiRequest(key(ctx), "/group", body);
    },
  });
}
