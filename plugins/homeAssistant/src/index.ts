import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  baseUrl: string, token: string, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${baseUrl}/api${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const opts: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Home Assistant API error ${res.status}: ${await res.text()}`);
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const cfg = ctx.connection.config;
  const ssl = cfg.ssl === true || cfg.ssl === "true";
  const proto = ssl ? "https" : "http";
  return { baseUrl: `${proto}://${cfg.host}:${cfg.port ?? 8123}`, token: cfg.accessToken as string };
}

function ha(ctx: { connection: { config: Record<string, unknown> } }, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>) {
  const { baseUrl, token } = getConn(ctx);
  return apiRequest(baseUrl, token, method, endpoint, body, qs);
}

export default function homeAssistant(rl: RunlinePluginAPI) {
  rl.setName("homeAssistant");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    host: { type: "string", required: true, description: "Home Assistant host (e.g. 192.168.1.100)", env: "HASS_HOST" },
    port: { type: "number", required: false, description: "Port (default: 8123)", default: "8123" },
    ssl: { type: "boolean", required: false, description: "Use HTTPS", default: "false" },
    accessToken: { type: "string", required: true, description: "Long-lived access token", env: "HASS_TOKEN" },
  });

  rl.registerAction("config.get", {
    description: "Get Home Assistant configuration",
    async execute(_input, ctx) { return ha(ctx, "GET", "/config"); },
  });

  rl.registerAction("config.check", {
    description: "Check if configuration is valid",
    async execute(_input, ctx) { return ha(ctx, "POST", "/config/core/check_config"); },
  });

  rl.registerAction("service.list", {
    description: "List available services",
    async execute(_input, ctx) { return ha(ctx, "GET", "/services"); },
  });

  rl.registerAction("service.call", {
    description: "Call a service",
    inputSchema: {
      domain: { type: "string", required: true, description: "Service domain (e.g. light, switch)" },
      service: { type: "string", required: true, description: "Service name (e.g. turn_on)" },
      serviceData: { type: "object", required: false, description: "Service data (e.g. {entity_id: 'light.kitchen'})" },
    },
    async execute(input, ctx) {
      const { domain, service, serviceData } = input as Record<string, unknown>;
      return ha(ctx, "POST", `/services/${domain}/${service}`, (serviceData as Record<string, unknown>) ?? {});
    },
  });

  rl.registerAction("state.list", {
    description: "List all entity states",
    async execute(_input, ctx) { return ha(ctx, "GET", "/states"); },
  });

  rl.registerAction("state.get", {
    description: "Get state of an entity",
    inputSchema: { entityId: { type: "string", required: true, description: "Entity ID (e.g. light.kitchen)" } },
    async execute(input, ctx) { return ha(ctx, "GET", `/states/${(input as { entityId: string }).entityId}`); },
  });

  rl.registerAction("state.set", {
    description: "Set/update state of an entity",
    inputSchema: {
      entityId: { type: "string", required: true, description: "Entity ID" },
      state: { type: "string", required: true, description: "New state value" },
      attributes: { type: "object", required: false, description: "State attributes" },
    },
    async execute(input, ctx) {
      const { entityId, state, attributes } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { state };
      if (attributes) body.attributes = attributes;
      return ha(ctx, "POST", `/states/${entityId}`, body);
    },
  });

  rl.registerAction("event.list", {
    description: "List event types",
    async execute(_input, ctx) { return ha(ctx, "GET", "/events"); },
  });

  rl.registerAction("event.fire", {
    description: "Fire an event",
    inputSchema: {
      eventType: { type: "string", required: true, description: "Event type" },
      eventData: { type: "object", required: false, description: "Event data" },
    },
    async execute(input, ctx) {
      const { eventType, eventData } = input as Record<string, unknown>;
      return ha(ctx, "POST", `/events/${eventType}`, (eventData as Record<string, unknown>) ?? {});
    },
  });

  rl.registerAction("log.getErrors", {
    description: "Get error log",
    async execute(_input, ctx) { return ha(ctx, "GET", "/error_log"); },
  });

  rl.registerAction("log.getLogbook", {
    description: "Get logbook entries",
    inputSchema: {
      entityId: { type: "string", required: false, description: "Filter by entity ID" },
      startTime: { type: "string", required: false, description: "Start time (ISO 8601)" },
      endTime: { type: "string", required: false, description: "End time (ISO 8601)" },
    },
    async execute(input, ctx) {
      const { entityId, startTime, endTime } = (input ?? {}) as Record<string, unknown>;
      let endpoint = "/logbook";
      if (startTime) endpoint += `/${startTime}`;
      const qs: Record<string, unknown> = {};
      if (entityId) qs.entity = entityId;
      if (endTime) qs.end_time = endTime;
      return ha(ctx, "GET", endpoint, undefined, qs);
    },
  });

  rl.registerAction("template.render", {
    description: "Render a Jinja2 template",
    inputSchema: { template: { type: "string", required: true, description: "Jinja2 template string" } },
    async execute(input, ctx) { return ha(ctx, "POST", "/template", { template: (input as { template: string }).template }); },
  });

  rl.registerAction("history.get", {
    description: "Get state history for entities",
    inputSchema: {
      entityIds: { type: "string", required: false, description: "Comma-separated entity IDs" },
      startTime: { type: "string", required: false, description: "Start time (ISO 8601)" },
      endTime: { type: "string", required: false, description: "End time" },
    },
    async execute(input, ctx) {
      const { entityIds, startTime, endTime } = (input ?? {}) as Record<string, unknown>;
      let endpoint = "/history/period";
      if (startTime) endpoint += `/${startTime}`;
      const qs: Record<string, unknown> = {};
      if (entityIds) qs.filter_entity_id = entityIds;
      if (endTime) qs.end_time = endTime;
      return ha(ctx, "GET", endpoint, undefined, qs);
    },
  });
}
