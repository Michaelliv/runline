import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.harvestapp.com/v2";

async function apiRequest(
  token: string, accountId: string, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const opts: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, "Harvest-Account-Id": accountId, "Content-Type": "application/json", "User-Agent": "Runline" },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Harvest API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return { token: ctx.connection.config.token as string, accountId: ctx.connection.config.accountId as string };
}

function hv(ctx: { connection: { config: Record<string, unknown> } }, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>) {
  const { token, accountId } = getConn(ctx);
  return apiRequest(token, accountId, method, endpoint, body, qs);
}

function unwrapList(data: unknown, key: string): unknown {
  if (data && typeof data === "object" && key in (data as Record<string, unknown>)) return (data as Record<string, unknown>)[key];
  return data;
}

function registerCrud(rl: RunlinePluginAPI, resource: string, apiPath: string, listKey: string) {
  rl.registerAction(`${resource}.create`, {
    description: `Create a ${resource}`, inputSchema: { properties: { type: "object", required: true, description: `${resource} data` } },
    async execute(input, ctx) { return hv(ctx, "POST", apiPath, (input as { properties: Record<string, unknown> }).properties); },
  });
  rl.registerAction(`${resource}.get`, {
    description: `Get a ${resource}`, inputSchema: { id: { type: "number", required: true, description: `${resource} ID` } },
    async execute(input, ctx) { return hv(ctx, "GET", `${apiPath}/${(input as { id: number }).id}`); },
  });
  rl.registerAction(`${resource}.list`, {
    description: `List ${resource}s`, inputSchema: { limit: { type: "number", required: false, description: "Max results" }, page: { type: "number", required: false, description: "Page" } },
    async execute(input, ctx) { const { limit, page } = (input ?? {}) as Record<string, unknown>; const qs: Record<string, unknown> = {}; if (limit) qs.per_page = limit; if (page) qs.page = page; return unwrapList(await hv(ctx, "GET", apiPath, undefined, qs), listKey); },
  });
  rl.registerAction(`${resource}.update`, {
    description: `Update a ${resource}`, inputSchema: { id: { type: "number", required: true, description: `${resource} ID` }, properties: { type: "object", required: true, description: "Fields to update" } },
    async execute(input, ctx) { const { id, properties } = input as { id: number; properties: Record<string, unknown> }; return hv(ctx, "PATCH", `${apiPath}/${id}`, properties); },
  });
  rl.registerAction(`${resource}.delete`, {
    description: `Delete a ${resource}`, inputSchema: { id: { type: "number", required: true, description: `${resource} ID` } },
    async execute(input, ctx) { await hv(ctx, "DELETE", `${apiPath}/${(input as { id: number }).id}`); return { success: true }; },
  });
}

export default function harvest(rl: RunlinePluginAPI) {
  rl.setName("harvest");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    token: { type: "string", required: true, description: "Harvest personal access token", env: "HARVEST_TOKEN" },
    accountId: { type: "string", required: true, description: "Harvest account ID", env: "HARVEST_ACCOUNT_ID" },
  });

  // Standard CRUD resources
  registerCrud(rl, "client", "clients", "clients");
  registerCrud(rl, "project", "projects", "projects");
  registerCrud(rl, "task", "tasks", "tasks");
  registerCrud(rl, "contact", "contacts", "contacts");
  registerCrud(rl, "invoice", "invoices", "invoices");
  registerCrud(rl, "expense", "expenses", "expenses");
  registerCrud(rl, "estimate", "estimates", "estimates");

  // User (CRUD + me)
  registerCrud(rl, "user", "users", "users");
  rl.registerAction("user.me", {
    description: "Get the currently authenticated user",
    async execute(_input, ctx) { return hv(ctx, "GET", "users/me"); },
  });

  // Time entry (special operations)
  rl.registerAction("timeEntry.create", {
    description: "Create a time entry",
    inputSchema: {
      projectId: { type: "number", required: true, description: "Project ID" },
      taskId: { type: "number", required: true, description: "Task ID" },
      spentDate: { type: "string", required: true, description: "Date (YYYY-MM-DD)" },
      hours: { type: "number", required: false, description: "Hours (for duration-based)" },
      startedTime: { type: "string", required: false, description: "Start time HH:MM (for start/end)" },
      endedTime: { type: "string", required: false, description: "End time HH:MM" },
      notes: { type: "string", required: false, description: "Notes" },
      userId: { type: "number", required: false, description: "User ID (admin only)" },
    },
    async execute(input, ctx) {
      const { projectId, taskId, spentDate, hours, startedTime, endedTime, notes, userId } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { project_id: projectId, task_id: taskId, spent_date: spentDate };
      if (hours !== undefined) body.hours = hours;
      if (startedTime) body.started_time = startedTime;
      if (endedTime) body.ended_time = endedTime;
      if (notes) body.notes = notes;
      if (userId) body.user_id = userId;
      return hv(ctx, "POST", "time_entries", body);
    },
  });

  rl.registerAction("timeEntry.get", {
    description: "Get a time entry", inputSchema: { id: { type: "number", required: true, description: "Time entry ID" } },
    async execute(input, ctx) { return hv(ctx, "GET", `time_entries/${(input as { id: number }).id}`); },
  });

  rl.registerAction("timeEntry.list", {
    description: "List time entries",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      page: { type: "number", required: false, description: "Page" },
      from: { type: "string", required: false, description: "From date (YYYY-MM-DD)" },
      to: { type: "string", required: false, description: "To date (YYYY-MM-DD)" },
      userId: { type: "number", required: false, description: "Filter by user" },
      projectId: { type: "number", required: false, description: "Filter by project" },
    },
    async execute(input, ctx) {
      const { limit, page, from, to, userId, projectId } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.per_page = limit;
      if (page) qs.page = page;
      if (from) qs.from = from;
      if (to) qs.to = to;
      if (userId) qs.user_id = userId;
      if (projectId) qs.project_id = projectId;
      return unwrapList(await hv(ctx, "GET", "time_entries", undefined, qs), "time_entries");
    },
  });

  rl.registerAction("timeEntry.update", {
    description: "Update a time entry",
    inputSchema: { id: { type: "number", required: true, description: "Time entry ID" }, properties: { type: "object", required: true, description: "Fields to update" } },
    async execute(input, ctx) { const { id, properties } = input as { id: number; properties: Record<string, unknown> }; return hv(ctx, "PATCH", `time_entries/${id}`, properties); },
  });

  rl.registerAction("timeEntry.delete", {
    description: "Delete a time entry", inputSchema: { id: { type: "number", required: true, description: "Time entry ID" } },
    async execute(input, ctx) { await hv(ctx, "DELETE", `time_entries/${(input as { id: number }).id}`); return { success: true }; },
  });

  rl.registerAction("timeEntry.restart", {
    description: "Restart a stopped time entry", inputSchema: { id: { type: "number", required: true, description: "Time entry ID" } },
    async execute(input, ctx) { return hv(ctx, "PATCH", `time_entries/${(input as { id: number }).id}/restart`); },
  });

  rl.registerAction("timeEntry.stop", {
    description: "Stop a running time entry", inputSchema: { id: { type: "number", required: true, description: "Time entry ID" } },
    async execute(input, ctx) { return hv(ctx, "PATCH", `time_entries/${(input as { id: number }).id}/stop`); },
  });

  // Company (read-only)
  rl.registerAction("company.get", {
    description: "Get company info",
    async execute(_input, ctx) { return hv(ctx, "GET", "company"); },
  });
}
