import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { harvestCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function hv(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, harvestCredential, "harvest", {
    target: "api",
    path,
    method,
    query: qs,
    headers: {
      "Harvest-Account-Id": String(ctx.connection.config.accountId),
      "User-Agent": "Runline",
    },
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: body }
      : {}),
  });
}

function unwrapList(data: unknown, key: string): unknown {
  if (
    data &&
    typeof data === "object" &&
    key in (data as Record<string, unknown>)
  )
    return (data as Record<string, unknown>)[key];
  return data;
}

function registerCrud(
  rl: RunlinePluginAPI,
  resource: string,
  apiPath: string,
  listKey: string,
) {
  rl.registerAction(`${resource}.create`, {
    access: "write",
    description: `Create a ${resource}`,
    inputSchema: {
      properties: {
        type: "object",
        required: true,
        description: `${resource} data`,
      },
    },
    async execute(input, ctx) {
      return hv(
        ctx,
        "POST",
        apiPath,
        (input as { properties: Record<string, unknown> }).properties,
      );
    },
  });
  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource}`,
    inputSchema: {
      id: { type: "number", required: true, description: `${resource} ID` },
    },
    async execute(input, ctx) {
      return hv(ctx, "GET", `${apiPath}/${seg((input as { id: number }).id)}`);
    },
  });
  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `List ${resource}s`,
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      page: { type: "number", required: false, description: "Page" },
    },
    async execute(input, ctx) {
      const { limit, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.per_page = limit;
      if (page) qs.page = page;
      return unwrapList(await hv(ctx, "GET", apiPath, undefined, qs), listKey);
    },
  });
  rl.registerAction(`${resource}.update`, {
    access: "write",
    description: `Update a ${resource}`,
    inputSchema: {
      id: { type: "number", required: true, description: `${resource} ID` },
      properties: {
        type: "object",
        required: true,
        description: "Fields to update",
      },
    },
    async execute(input, ctx) {
      const { id, properties } = input as {
        id: number;
        properties: Record<string, unknown>;
      };
      return hv(ctx, "PATCH", `${apiPath}/${seg(id)}`, properties);
    },
  });
  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: {
      id: { type: "number", required: true, description: `${resource} ID` },
    },
    async execute(input, ctx) {
      await hv(
        ctx,
        "DELETE",
        `${apiPath}/${seg((input as { id: number }).id)}`,
      );
      return { success: true };
    },
  });
}

export default function harvest(rl: RunlinePluginAPI) {
  rl.setName("harvest");
  rl.setVersion("0.1.0");
  rl.setCredential(harvestCredential);

  rl.setConnectionSchema({
    token: {
      type: "string",
      required: true,
      description: "Harvest personal access token",
      env: "HARVEST_TOKEN",
    },
    accountId: {
      type: "string",
      required: true,
      description: "Harvest account ID",
      env: "HARVEST_ACCOUNT_ID",
    },
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
    access: "read",
    description: "Get the currently authenticated user",
    async execute(_input, ctx) {
      return hv(ctx, "GET", "users/me");
    },
  });

  // Time entry (special operations)
  rl.registerAction("timeEntry.create", {
    access: "write",
    description: "Create a time entry",
    inputSchema: {
      projectId: { type: "number", required: true, description: "Project ID" },
      taskId: { type: "number", required: true, description: "Task ID" },
      spentDate: {
        type: "string",
        required: true,
        description: "Date (YYYY-MM-DD)",
      },
      hours: {
        type: "number",
        required: false,
        description: "Hours (for duration-based)",
      },
      startedTime: {
        type: "string",
        required: false,
        description: "Start time HH:MM (for start/end)",
      },
      endedTime: {
        type: "string",
        required: false,
        description: "End time HH:MM",
      },
      notes: { type: "string", required: false, description: "Notes" },
      userId: {
        type: "number",
        required: false,
        description: "User ID (admin only)",
      },
    },
    async execute(input, ctx) {
      const {
        projectId,
        taskId,
        spentDate,
        hours,
        startedTime,
        endedTime,
        notes,
        userId,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        project_id: projectId,
        task_id: taskId,
        spent_date: spentDate,
      };
      if (hours !== undefined) body.hours = hours;
      if (startedTime) body.started_time = startedTime;
      if (endedTime) body.ended_time = endedTime;
      if (notes) body.notes = notes;
      if (userId) body.user_id = userId;
      return hv(ctx, "POST", "time_entries", body);
    },
  });

  rl.registerAction("timeEntry.get", {
    access: "read",
    description: "Get a time entry",
    inputSchema: {
      id: { type: "number", required: true, description: "Time entry ID" },
    },
    async execute(input, ctx) {
      return hv(
        ctx,
        "GET",
        `time_entries/${seg((input as { id: number }).id)}`,
      );
    },
  });

  rl.registerAction("timeEntry.list", {
    access: "read",
    description: "List time entries",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      page: { type: "number", required: false, description: "Page" },
      from: {
        type: "string",
        required: false,
        description: "From date (YYYY-MM-DD)",
      },
      to: {
        type: "string",
        required: false,
        description: "To date (YYYY-MM-DD)",
      },
      userId: {
        type: "number",
        required: false,
        description: "Filter by user",
      },
      projectId: {
        type: "number",
        required: false,
        description: "Filter by project",
      },
    },
    async execute(input, ctx) {
      const { limit, page, from, to, userId, projectId } = (input ??
        {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.per_page = limit;
      if (page) qs.page = page;
      if (from) qs.from = from;
      if (to) qs.to = to;
      if (userId) qs.user_id = userId;
      if (projectId) qs.project_id = projectId;
      return unwrapList(
        await hv(ctx, "GET", "time_entries", undefined, qs),
        "time_entries",
      );
    },
  });

  rl.registerAction("timeEntry.update", {
    access: "write",
    description: "Update a time entry",
    inputSchema: {
      id: { type: "number", required: true, description: "Time entry ID" },
      properties: {
        type: "object",
        required: true,
        description: "Fields to update",
      },
    },
    async execute(input, ctx) {
      const { id, properties } = input as {
        id: number;
        properties: Record<string, unknown>;
      };
      return hv(ctx, "PATCH", `time_entries/${seg(id)}`, properties);
    },
  });

  rl.registerAction("timeEntry.delete", {
    access: "write",
    description: "Delete a time entry",
    inputSchema: {
      id: { type: "number", required: true, description: "Time entry ID" },
    },
    async execute(input, ctx) {
      await hv(
        ctx,
        "DELETE",
        `time_entries/${seg((input as { id: number }).id)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("timeEntry.restart", {
    access: "write",
    description: "Restart a stopped time entry",
    inputSchema: {
      id: { type: "number", required: true, description: "Time entry ID" },
    },
    async execute(input, ctx) {
      return hv(
        ctx,
        "PATCH",
        `time_entries/${seg((input as { id: number }).id)}/restart`,
      );
    },
  });

  rl.registerAction("timeEntry.stop", {
    access: "write",
    description: "Stop a running time entry",
    inputSchema: {
      id: { type: "number", required: true, description: "Time entry ID" },
    },
    async execute(input, ctx) {
      return hv(
        ctx,
        "PATCH",
        `time_entries/${seg((input as { id: number }).id)}/stop`,
      );
    },
  });

  // Company (read-only)
  rl.registerAction("company.get", {
    access: "read",
    description: "Get company info",
    async execute(_input, ctx) {
      return hv(ctx, "GET", "company");
    },
  });
}
