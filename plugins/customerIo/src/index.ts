import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  siteId: string,
  apiKey: string,
  method: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${siteId}:${apiKey}`)}`,
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Customer.io API error ${res.status}: ${await res.text()}`);
  if (res.status === 204 || res.headers.get("content-length") === "0") return { success: true };
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return { success: true };
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const cfg = ctx.connection.config;
  const region = (cfg.region as string) ?? "track.customer.io";
  const isEu = region.includes("-eu");
  return {
    siteId: cfg.siteId as string,
    trackingApiKey: cfg.trackingApiKey as string,
    appApiKey: cfg.appApiKey as string,
    trackingBase: `https://${region}/api/v1`,
    appBase: isEu ? "https://api-eu.customer.io/v1" : "https://api.customer.io/v1",
  };
}

function tracking(ctx: { connection: { config: Record<string, unknown> } }, method: string, endpoint: string, body?: Record<string, unknown>) {
  const { siteId, trackingApiKey, trackingBase } = getConn(ctx);
  return apiRequest(siteId, trackingApiKey, method, `${trackingBase}${endpoint}`, body);
}

function app(ctx: { connection: { config: Record<string, unknown> } }, method: string, endpoint: string, body?: Record<string, unknown>) {
  const { siteId, appApiKey, appBase } = getConn(ctx);
  return apiRequest(siteId, appApiKey, method, `${appBase}${endpoint}`, body);
}

export default function customerIo(rl: RunlinePluginAPI) {
  rl.setName("customerIo");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    siteId: { type: "string", required: true, description: "Customer.io Site ID", env: "CUSTOMERIO_SITE_ID" },
    trackingApiKey: { type: "string", required: true, description: "Tracking API key", env: "CUSTOMERIO_TRACKING_API_KEY" },
    appApiKey: { type: "string", required: true, description: "App API key (for campaigns)", env: "CUSTOMERIO_APP_API_KEY" },
    region: { type: "string", required: false, description: "Region: track.customer.io (US, default) or track-eu.customer.io (EU)", default: "track.customer.io" },
  });

  // ── Campaign ────────────────────────────────────────

  rl.registerAction("campaign.get", {
    description: "Get a campaign by ID",
    inputSchema: { campaignId: { type: "number", required: true, description: "Campaign ID" } },
    async execute(input, ctx) {
      const { campaignId } = input as { campaignId: number };
      const data = (await app(ctx, "GET", `/campaigns/${campaignId}`)) as Record<string, unknown>;
      return data.campaign;
    },
  });

  rl.registerAction("campaign.list", {
    description: "List all campaigns",
    async execute(_input, ctx) {
      const data = (await app(ctx, "GET", "/campaigns")) as Record<string, unknown>;
      return data.campaigns;
    },
  });

  rl.registerAction("campaign.getMetrics", {
    description: "Get campaign metrics",
    inputSchema: {
      campaignId: { type: "number", required: true, description: "Campaign ID" },
      period: { type: "string", required: false, description: "Period: days (default), weeks, months" },
      steps: { type: "number", required: false, description: "Number of steps/periods" },
      type: { type: "string", required: false, description: "Metric type: email, webhook, push, slack, urbanAirship" },
    },
    async execute(input, ctx) {
      const { campaignId, period, steps, type } = (input ?? {}) as Record<string, unknown>;
      let endpoint = `/campaigns/${campaignId}/metrics`;
      if (period && period !== "days") endpoint += `?period=${period}`;
      const body: Record<string, unknown> = {};
      if (steps) body.steps = steps;
      if (type) body.type = type === "urbanAirship" ? "urban_airship" : type;
      const data = (await app(ctx, "GET", endpoint, body)) as Record<string, unknown>;
      return data.metric;
    },
  });

  // ── Customer ────────────────────────────────────────

  rl.registerAction("customer.upsert", {
    description: "Create or update a customer",
    inputSchema: {
      id: { type: "string", required: true, description: "Customer ID (your internal ID)" },
      email: { type: "string", required: false, description: "Email address" },
      createdAt: { type: "string", required: false, description: "Created at (ISO 8601)" },
      attributes: { type: "object", required: false, description: "Custom attributes as key-value pairs" },
    },
    async execute(input, ctx) {
      const { id, email, createdAt, attributes } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (email) body.email = email;
      if (createdAt) body.created_at = Math.floor(new Date(createdAt as string).getTime() / 1000);
      if (attributes) body.data = attributes;
      await tracking(ctx, "PUT", `/customers/${id}`, body);
      return { id, ...body };
    },
  });

  rl.registerAction("customer.delete", {
    description: "Delete a customer",
    inputSchema: { id: { type: "string", required: true, description: "Customer ID" } },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      await tracking(ctx, "DELETE", `/customers/${id}`);
      return { success: true };
    },
  });

  // ── Event ───────────────────────────────────────────

  rl.registerAction("event.track", {
    description: "Track an event for a customer",
    inputSchema: {
      customerId: { type: "string", required: true, description: "Customer ID" },
      eventName: { type: "string", required: true, description: "Event name" },
      type: { type: "string", required: false, description: "Event type (e.g. page)" },
      data: { type: "object", required: false, description: "Custom event attributes" },
    },
    async execute(input, ctx) {
      const { customerId, eventName, type, data } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: eventName };
      const eventData: Record<string, unknown> = {};
      if (type) eventData.type = type;
      if (data) Object.assign(eventData, data);
      if (Object.keys(eventData).length > 0) body.data = eventData;
      await tracking(ctx, "POST", `/customers/${customerId}/events`, body);
      return { success: true };
    },
  });

  rl.registerAction("event.trackAnonymous", {
    description: "Track an anonymous event (not tied to a customer)",
    inputSchema: {
      eventName: { type: "string", required: true, description: "Event name" },
      data: { type: "object", required: false, description: "Custom event attributes" },
    },
    async execute(input, ctx) {
      const { eventName, data } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: eventName };
      if (data) body.data = data;
      await tracking(ctx, "POST", "/events", body);
      return { success: true };
    },
  });

  // ── Segment ─────────────────────────────────────────

  rl.registerAction("segment.addCustomers", {
    description: "Add customers to a manual segment",
    inputSchema: {
      segmentId: { type: "number", required: true, description: "Segment ID" },
      customerIds: { type: "array", required: true, description: "Array of customer IDs" },
    },
    async execute(input, ctx) {
      const { segmentId, customerIds } = input as { segmentId: number; customerIds: string[] };
      await tracking(ctx, "POST", `/segments/${segmentId}/add_customers`, { ids: customerIds });
      return { success: true };
    },
  });

  rl.registerAction("segment.removeCustomers", {
    description: "Remove customers from a manual segment",
    inputSchema: {
      segmentId: { type: "number", required: true, description: "Segment ID" },
      customerIds: { type: "array", required: true, description: "Array of customer IDs" },
    },
    async execute(input, ctx) {
      const { segmentId, customerIds } = input as { segmentId: number; customerIds: string[] };
      await tracking(ctx, "POST", `/segments/${segmentId}/remove_customers`, { ids: customerIds });
      return { success: true };
    },
  });
}
