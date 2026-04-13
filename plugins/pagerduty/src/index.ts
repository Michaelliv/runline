import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.pagerduty.com";

interface Conn { config: Record<string, unknown> }
function getToken(ctx: { connection: Conn }): string { return ctx.connection.config.apiToken as string; }

async function apiRequest(
  token: string, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const headers: Record<string, string> = {
    Authorization: `Token token=${token}`,
    Accept: "application/vnd.pagerduty+json;version=2",
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  const init: RequestInit = { method, headers };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`PagerDuty API error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function paginate(
  token: string, endpoint: string, propertyName: string, qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  qs.limit = 100; qs.offset = 0;
  let hasMore = true;
  while (hasMore) {
    const data = (await apiRequest(token, "GET", endpoint, undefined, qs)) as Record<string, unknown>;
    const items = (data[propertyName] ?? []) as unknown[];
    all.push(...items);
    hasMore = data.more === true;
    qs.offset = (qs.offset as number) + (qs.limit as number);
  }
  return all;
}

export default function pagerduty(rl: RunlinePluginAPI) {
  rl.setName("pagerduty");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiToken: { type: "string", required: true, description: "PagerDuty API token", env: "PAGERDUTY_API_TOKEN" },
  });

  // ── Incident ────────────────────────────────────────

  rl.registerAction("incident.create", {
    description: "Create a new incident",
    inputSchema: {
      title: { type: "string", required: true },
      serviceId: { type: "string", required: true, description: "Service ID" },
      from: { type: "string", required: true, description: "Email of the user creating the incident" },
      urgency: { type: "string", required: false, description: "high or low" },
      details: { type: "string", required: false, description: "Incident body details" },
      priorityId: { type: "string", required: false },
      escalationPolicyId: { type: "string", required: false },
      incidentKey: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const incident: Record<string, unknown> = {
        type: "incident", title: p.title,
        service: { id: p.serviceId, type: "service_reference" },
      };
      if (p.urgency) incident.urgency = p.urgency;
      if (p.details) incident.body = { type: "incident_body", details: p.details };
      if (p.priorityId) incident.priority = { id: p.priorityId, type: "priority_reference" };
      if (p.escalationPolicyId) incident.escalation_policy = { id: p.escalationPolicyId, type: "escalation_policy_reference" };
      if (p.incidentKey) incident.incident_key = p.incidentKey;
      const data = (await apiRequest(getToken(ctx), "POST", "/incidents", { incident }, undefined, { From: p.from as string })) as Record<string, unknown>;
      return data.incident;
    },
  });

  rl.registerAction("incident.get", {
    description: "Get an incident by ID",
    inputSchema: { incidentId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { incidentId } = input as Record<string, unknown>;
      const data = (await apiRequest(getToken(ctx), "GET", `/incidents/${incidentId}`)) as Record<string, unknown>;
      return data.incident;
    },
  });

  rl.registerAction("incident.list", {
    description: "List incidents",
    inputSchema: {
      limit: { type: "number", required: false },
      statuses: { type: "string", required: false, description: "Comma-separated: triggered,acknowledged,resolved" },
      sortBy: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.statuses) qs["statuses[]"] = p.statuses;
      if (p.sortBy) qs.sort_by = p.sortBy;
      if (p.limit) { qs.limit = p.limit; const d = (await apiRequest(getToken(ctx), "GET", "/incidents", undefined, qs)) as Record<string, unknown>; return d.incidents; }
      return paginate(getToken(ctx), "/incidents", "incidents", qs);
    },
  });

  rl.registerAction("incident.update", {
    description: "Update an incident",
    inputSchema: {
      incidentId: { type: "string", required: true },
      from: { type: "string", required: true, description: "Email of the user updating" },
      title: { type: "string", required: false },
      status: { type: "string", required: false, description: "acknowledged, resolved" },
      urgency: { type: "string", required: false },
      resolution: { type: "string", required: false },
      escalationLevel: { type: "number", required: false },
      priorityId: { type: "string", required: false },
      escalationPolicyId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const incident: Record<string, unknown> = { type: "incident" };
      if (p.title) incident.title = p.title;
      if (p.status) incident.status = p.status;
      if (p.urgency) incident.urgency = p.urgency;
      if (p.resolution) incident.resolution = p.resolution;
      if (p.escalationLevel) incident.escalation_level = p.escalationLevel;
      if (p.priorityId) incident.priority = { id: p.priorityId, type: "priority_reference" };
      if (p.escalationPolicyId) incident.escalation_policy = { id: p.escalationPolicyId, type: "escalation_policy_reference" };
      const data = (await apiRequest(getToken(ctx), "PUT", `/incidents/${p.incidentId}`, { incident }, undefined, { From: p.from as string })) as Record<string, unknown>;
      return data.incident;
    },
  });

  // ── Incident Note ───────────────────────────────────

  rl.registerAction("incidentNote.create", {
    description: "Add a note to an incident",
    inputSchema: {
      incidentId: { type: "string", required: true },
      from: { type: "string", required: true, description: "Email of the user" },
      content: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { incidentId, from, content } = input as Record<string, unknown>;
      return apiRequest(getToken(ctx), "POST", `/incidents/${incidentId}/notes`, { note: { content } }, undefined, { From: from as string });
    },
  });

  rl.registerAction("incidentNote.list", {
    description: "List notes for an incident",
    inputSchema: { incidentId: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      const data = (await apiRequest(getToken(ctx), "GET", `/incidents/${p.incidentId}/notes`, undefined, qs)) as Record<string, unknown>;
      return data.notes;
    },
  });

  // ── Log Entry ───────────────────────────────────────

  rl.registerAction("logEntry.get", {
    description: "Get a log entry by ID",
    inputSchema: { logEntryId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { logEntryId } = input as Record<string, unknown>;
      const data = (await apiRequest(getToken(ctx), "GET", `/log_entries/${logEntryId}`)) as Record<string, unknown>;
      return data.log_entry;
    },
  });

  rl.registerAction("logEntry.list", {
    description: "List log entries",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      if (p.limit) {
        const data = (await apiRequest(getToken(ctx), "GET", "/log_entries", undefined, { limit: p.limit })) as Record<string, unknown>;
        return data.log_entries;
      }
      return paginate(getToken(ctx), "/log_entries", "log_entries");
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.get", {
    description: "Get a user by ID",
    inputSchema: { userId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { userId } = input as Record<string, unknown>;
      const data = (await apiRequest(getToken(ctx), "GET", `/users/${userId}`)) as Record<string, unknown>;
      return data.user;
    },
  });
}
