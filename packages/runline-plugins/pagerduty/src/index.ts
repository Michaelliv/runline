import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialRequest } from "../../_shared/credentials.js";
import { pagerdutyCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

async function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const json = body && Object.keys(body).length > 0 ? body : undefined;
  const res = await credentialRequest(ctx, pagerdutyCredential, {
    target: "api",
    path,
    method,
    query: qs,
    headers: {
      Accept: "application/vnd.pagerduty+json;version=2",
      ...extraHeaders,
    },
    ...(json !== undefined ? { json } : {}),
  });
  if (!res.ok)
    throw new Error(`pagerduty: request failed (HTTP ${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function paginate(
  ctx: ActionContext,
  path: string,
  propertyName: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  qs.limit = 100;
  qs.offset = 0;
  let hasMore = true;
  while (hasMore) {
    const data = (await apiRequest(ctx, "GET", path, undefined, qs)) as Record<
      string,
      unknown
    >;
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
  rl.setCredential(pagerdutyCredential);

  rl.setConnectionSchema({
    apiToken: {
      type: "string",
      required: true,
      description: "PagerDuty API token",
      env: "PAGERDUTY_API_TOKEN",
    },
  });

  // ── Incident ────────────────────────────────────────

  rl.registerAction("incident.create", {
    access: "write",
    description: "Create a new incident",
    inputSchema: {
      title: { type: "string", required: true },
      serviceId: { type: "string", required: true, description: "Service ID" },
      from: {
        type: "string",
        required: true,
        description: "Email of the user creating the incident",
      },
      urgency: { type: "string", required: false, description: "high or low" },
      details: {
        type: "string",
        required: false,
        description: "Incident body details",
      },
      priorityId: { type: "string", required: false },
      escalationPolicyId: { type: "string", required: false },
      incidentKey: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const incident: Record<string, unknown> = {
        type: "incident",
        title: p.title,
        service: { id: p.serviceId, type: "service_reference" },
      };
      if (p.urgency) incident.urgency = p.urgency;
      if (p.details)
        incident.body = { type: "incident_body", details: p.details };
      if (p.priorityId)
        incident.priority = { id: p.priorityId, type: "priority_reference" };
      if (p.escalationPolicyId)
        incident.escalation_policy = {
          id: p.escalationPolicyId,
          type: "escalation_policy_reference",
        };
      if (p.incidentKey) incident.incident_key = p.incidentKey;
      const data = (await apiRequest(
        ctx,
        "POST",
        "incidents",
        { incident },
        undefined,
        { From: p.from as string },
      )) as Record<string, unknown>;
      return data.incident;
    },
  });

  rl.registerAction("incident.get", {
    access: "read",
    description: "Get an incident by ID",
    inputSchema: { incidentId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { incidentId } = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "GET",
        `incidents/${seg(incidentId)}`,
      )) as Record<string, unknown>;
      return data.incident;
    },
  });

  rl.registerAction("incident.list", {
    access: "read",
    description: "List incidents",
    inputSchema: {
      limit: { type: "number", required: false },
      statuses: {
        type: "string",
        required: false,
        description: "Comma-separated: triggered,acknowledged,resolved",
      },
      sortBy: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.statuses) qs["statuses[]"] = p.statuses;
      if (p.sortBy) qs.sort_by = p.sortBy;
      if (p.limit) {
        qs.limit = p.limit;
        const d = (await apiRequest(
          ctx,
          "GET",
          "incidents",
          undefined,
          qs,
        )) as Record<string, unknown>;
        return d.incidents;
      }
      return paginate(ctx, "incidents", "incidents", qs);
    },
  });

  rl.registerAction("incident.update", {
    access: "write",
    description: "Update an incident",
    inputSchema: {
      incidentId: { type: "string", required: true },
      from: {
        type: "string",
        required: true,
        description: "Email of the user updating",
      },
      title: { type: "string", required: false },
      status: {
        type: "string",
        required: false,
        description: "acknowledged, resolved",
      },
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
      if (p.priorityId)
        incident.priority = { id: p.priorityId, type: "priority_reference" };
      if (p.escalationPolicyId)
        incident.escalation_policy = {
          id: p.escalationPolicyId,
          type: "escalation_policy_reference",
        };
      const data = (await apiRequest(
        ctx,
        "PUT",
        `incidents/${seg(p.incidentId)}`,
        { incident },
        undefined,
        { From: p.from as string },
      )) as Record<string, unknown>;
      return data.incident;
    },
  });

  // ── Incident Note ───────────────────────────────────

  rl.registerAction("incidentNote.create", {
    access: "write",
    description: "Add a note to an incident",
    inputSchema: {
      incidentId: { type: "string", required: true },
      from: {
        type: "string",
        required: true,
        description: "Email of the user",
      },
      content: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { incidentId, from, content } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "POST",
        `incidents/${seg(incidentId)}/notes`,
        { note: { content } },
        undefined,
        { From: from as string },
      );
    },
  });

  rl.registerAction("incidentNote.list", {
    access: "read",
    description: "List notes for an incident",
    inputSchema: {
      incidentId: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      const data = (await apiRequest(
        ctx,
        "GET",
        `incidents/${seg(p.incidentId)}/notes`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.notes;
    },
  });

  // ── Log Entry ───────────────────────────────────────

  rl.registerAction("logEntry.get", {
    access: "read",
    description: "Get a log entry by ID",
    inputSchema: { logEntryId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { logEntryId } = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "GET",
        `log_entries/${seg(logEntryId)}`,
      )) as Record<string, unknown>;
      return data.log_entry;
    },
  });

  rl.registerAction("logEntry.list", {
    access: "read",
    description: "List log entries",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      if (p.limit) {
        const data = (await apiRequest(ctx, "GET", "log_entries", undefined, {
          limit: p.limit,
        })) as Record<string, unknown>;
        return data.log_entries;
      }
      return paginate(ctx, "log_entries", "log_entries");
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.get", {
    access: "read",
    description: "Get a user by ID",
    inputSchema: { userId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { userId } = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "GET",
        `users/${seg(userId)}`,
      )) as Record<string, unknown>;
      return data.user;
    },
  });
}
