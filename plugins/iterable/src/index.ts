import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  baseUrl: string, apiKey: string, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${baseUrl}/api${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Iterable API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function iterable(rl: RunlinePluginAPI) {
  rl.setName("iterable");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Iterable API key", env: "ITERABLE_API_KEY" },
    region: { type: "string", required: false, description: "API base URL (default: https://api.iterable.com)", env: "ITERABLE_REGION", default: "https://api.iterable.com" },
  });

  const conn = (ctx: { connection: { config: Record<string, unknown> } }) => ({
    baseUrl: ((ctx.connection.config.region as string) ?? "https://api.iterable.com").replace(/\/$/, ""),
    apiKey: ctx.connection.config.apiKey as string,
  });

  // ── Event ───────────────────────────────────────────
  rl.registerAction("event.track", {
    description: "Track events for users (bulk). Each event requires email or userId, plus eventName.",
    inputSchema: {
      events: {
        type: "array", required: true,
        description: "Array of event objects. Each needs: eventName (string, required), email or id (string, one required), dataFields (object, optional), createdAt (unix timestamp, optional)",
      },
    },
    async execute(input, ctx) {
      const { events } = input as { events: Record<string, unknown>[] };
      const { baseUrl, apiKey } = conn(ctx);
      return apiRequest(baseUrl, apiKey, "POST", "/events/trackBulk", { events });
    },
  });

  // ── User ────────────────────────────────────────────
  rl.registerAction("user.upsert", {
    description: "Create or update a user",
    inputSchema: {
      identifier: { type: "string", required: true, description: "'email' or 'userId'" },
      value: { type: "string", required: true, description: "The email address or userId value" },
      preferUserId: { type: "boolean", required: false, description: "When identifier is userId, prefer userId for lookups (default false)" },
      dataFields: { type: "object", required: false, description: "User data fields as key-value pairs" },
    },
    async execute(input, ctx) {
      const { identifier, value, preferUserId, dataFields } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = conn(ctx);
      const body: Record<string, unknown> = {};
      if (identifier === "email") {
        body.email = value;
      } else {
        body.userId = value;
        if (preferUserId !== undefined) body.preferUserId = preferUserId;
      }
      if (dataFields) body.dataFields = dataFields;
      return apiRequest(baseUrl, apiKey, "POST", "/users/update", body);
    },
  });

  rl.registerAction("user.get", {
    description: "Get a user by email or userId",
    inputSchema: {
      by: { type: "string", required: true, description: "'email' or 'userId'" },
      value: { type: "string", required: true, description: "The email address or userId" },
    },
    async execute(input, ctx) {
      const { by, value } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = conn(ctx);
      if (by === "email") {
        const data = await apiRequest(baseUrl, apiKey, "GET", "/users/getByEmail", undefined, { email: value as string });
        return (data as Record<string, unknown>).user ?? data;
      }
      return apiRequest(baseUrl, apiKey, "GET", `/users/byUserId/${encodeURIComponent(value as string)}`);
    },
  });

  rl.registerAction("user.delete", {
    description: "Delete a user by email or userId",
    inputSchema: {
      by: { type: "string", required: true, description: "'email' or 'userId'" },
      value: { type: "string", required: true, description: "The email address or userId" },
    },
    async execute(input, ctx) {
      const { by, value } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = conn(ctx);
      const endpoint = by === "email"
        ? `/users/${encodeURIComponent(value as string)}`
        : `/users/byUserId/${encodeURIComponent(value as string)}`;
      return apiRequest(baseUrl, apiKey, "DELETE", endpoint);
    },
  });

  // ── User List ───────────────────────────────────────
  rl.registerAction("userList.add", {
    description: "Subscribe users to a list",
    inputSchema: {
      listId: { type: "number", required: true, description: "List ID" },
      identifier: { type: "string", required: true, description: "'email' or 'userId'" },
      values: { type: "array", required: true, description: "Array of email addresses or userIds to subscribe" },
    },
    async execute(input, ctx) {
      const { listId, identifier, values } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = conn(ctx);
      const subscribers = (values as string[]).map((v) =>
        identifier === "email" ? { email: v } : { userId: v },
      );
      return apiRequest(baseUrl, apiKey, "POST", "/lists/subscribe", { listId, subscribers });
    },
  });

  rl.registerAction("userList.remove", {
    description: "Unsubscribe users from a list",
    inputSchema: {
      listId: { type: "number", required: true, description: "List ID" },
      identifier: { type: "string", required: true, description: "'email' or 'userId'" },
      values: { type: "array", required: true, description: "Array of email addresses or userIds to unsubscribe" },
      campaignId: { type: "number", required: false, description: "Campaign ID for attribution" },
      channelUnsubscribe: { type: "boolean", required: false, description: "Unsubscribe from channel" },
    },
    async execute(input, ctx) {
      const { listId, identifier, values, campaignId, channelUnsubscribe } = input as Record<string, unknown>;
      const { baseUrl, apiKey } = conn(ctx);
      const subscribers = (values as string[]).map((v) =>
        identifier === "email" ? { email: v } : { userId: v },
      );
      const body: Record<string, unknown> = { listId, subscribers };
      if (campaignId !== undefined) body.campaignId = campaignId;
      if (channelUnsubscribe !== undefined) body.channelUnsubscribe = channelUnsubscribe;
      return apiRequest(baseUrl, apiKey, "POST", "/lists/unsubscribe", body);
    },
  });
}
