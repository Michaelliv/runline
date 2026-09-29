import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { onfleetCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: unknown,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, onfleetCredential, "onfleet", {
    target: "api",
    path,
    method,
    query: qs,
    headers: { "User-Agent": "runline-onfleet" },
    ...(body !== undefined && method !== "GET" ? { json: body } : {}),
  });
}

function registerCrud(
  rl: RunlinePluginAPI,
  resource: string,
  plural: string,
  createSchema: Record<
    string,
    { type: string; required: boolean; description?: string }
  >,
) {
  rl.registerAction(`${resource}.create`, {
    access: "write",
    description: `Create a ${resource}`,
    inputSchema: createSchema,
    async execute(input, ctx) {
      return apiRequest(ctx, "POST", plural, input);
    },
  });

  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource} by ID`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `${plural}/${pathSegment((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `List ${plural}`,
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const data = (await apiRequest(ctx, "GET", plural)) as unknown[];
      const p = (input ?? {}) as Record<string, unknown>;
      return p.limit ? data.slice(0, p.limit as number) : data;
    },
  });

  rl.registerAction(`${resource}.update`, {
    access: "write",
    description: `Update a ${resource}`,
    inputSchema: {
      id: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(ctx, "PUT", `${plural}/${pathSegment(p.id)}`, p.data);
    },
  });

  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `${plural}/${pathSegment((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });
}

export default function onfleet(rl: RunlinePluginAPI) {
  rl.setName("onfleet");
  rl.setVersion("0.1.0");
  rl.setCredential(onfleetCredential);
  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Onfleet API key",
      env: "ONFLEET_API_KEY",
    },
  });

  // ── Organization ────────────────────────────────────

  rl.registerAction("organization.get", {
    access: "read",
    description: "Get organization details",
    inputSchema: {},
    async execute(_input, ctx) {
      return apiRequest(ctx, "GET", "organization");
    },
  });

  // ── Task ────────────────────────────────────────────

  rl.registerAction("task.create", {
    access: "write",
    description: "Create a task",
    inputSchema: {
      destination: {
        type: "object",
        required: true,
        description:
          "{ address: { unparsed: string } } or { address: { number, street, city, country } }",
      },
      recipients: {
        type: "object",
        required: false,
        description: "Array of { name, phone }",
      },
      completeAfter: {
        type: "number",
        required: false,
        description: "Unix ms timestamp",
      },
      completeBefore: {
        type: "number",
        required: false,
        description: "Unix ms timestamp",
      },
      notes: { type: "string", required: false },
    },
    async execute(input, ctx) {
      return apiRequest(ctx, "POST", "tasks", input);
    },
  });

  rl.registerAction("task.get", {
    access: "read",
    description: "Get a task by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const id = (input as Record<string, unknown>).id as string;
      const path =
        id.length <= 8
          ? `tasks/shortId/${pathSegment(id)}`
          : `tasks/${pathSegment(id)}`;
      return apiRequest(ctx, "GET", path);
    },
  });

  rl.registerAction("task.list", {
    access: "read",
    description: "List tasks",
    inputSchema: {
      from: { type: "number", required: false, description: "Unix ms start" },
      to: { type: "number", required: false },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.from) qs.from = p.from;
      else qs.from = Date.now() - 604800000;
      if (p.to) qs.to = p.to;
      const data = (await apiRequest(
        ctx,
        "GET",
        "tasks/all",
        undefined,
        qs,
      )) as Record<string, unknown>;
      const tasks = data.tasks as unknown[];
      return p.limit ? tasks.slice(0, p.limit as number) : tasks;
    },
  });

  rl.registerAction("task.update", {
    access: "write",
    description: "Update a task",
    inputSchema: {
      id: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(ctx, "PUT", `tasks/${pathSegment(p.id)}`, p.data);
    },
  });

  rl.registerAction("task.delete", {
    access: "write",
    description: "Delete a task",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `tasks/${pathSegment((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("task.complete", {
    access: "write",
    description: "Force-complete a task",
    inputSchema: {
      id: { type: "string", required: true },
      success: { type: "boolean", required: true },
      notes: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        completionDetails: { success: p.success },
      };
      if (p.notes)
        (body.completionDetails as Record<string, unknown>).notes = p.notes;
      await apiRequest(
        ctx,
        "POST",
        `tasks/${pathSegment(p.id)}/complete`,
        body,
      );
      return { success: true };
    },
  });

  // ── Worker ──────────────────────────────────────────

  registerCrud(rl, "worker", "workers", {
    name: { type: "string", required: true },
    phone: { type: "string", required: true },
    teams: { type: "object", required: true, description: "Array of team IDs" },
  });

  // ── Admin ───────────────────────────────────────────

  registerCrud(rl, "admin", "admins", {
    name: { type: "string", required: true },
    email: { type: "string", required: true },
  });

  // ── Hub ─────────────────────────────────────────────

  rl.registerAction("hub.create", {
    access: "write",
    description: "Create a hub",
    inputSchema: {
      name: { type: "string", required: true },
      address: { type: "object", required: true },
    },
    async execute(input, ctx) {
      return apiRequest(ctx, "POST", "hubs", input);
    },
  });

  rl.registerAction("hub.list", {
    access: "read",
    description: "List hubs",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const data = (await apiRequest(ctx, "GET", "hubs")) as unknown[];
      const p = (input ?? {}) as Record<string, unknown>;
      return p.limit ? data.slice(0, p.limit as number) : data;
    },
  });

  rl.registerAction("hub.update", {
    access: "write",
    description: "Update a hub",
    inputSchema: {
      id: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(ctx, "PUT", `hubs/${pathSegment(p.id)}`, p.data);
    },
  });

  // ── Team ────────────────────────────────────────────

  registerCrud(rl, "team", "teams", {
    name: { type: "string", required: true },
    workers: {
      type: "object",
      required: true,
      description: "Array of worker IDs",
    },
    managers: {
      type: "object",
      required: true,
      description: "Array of admin IDs",
    },
  });

  // ── Recipient ───────────────────────────────────────

  rl.registerAction("recipient.create", {
    access: "write",
    description: "Create a recipient",
    inputSchema: {
      name: { type: "string", required: true },
      phone: { type: "string", required: true },
      notes: { type: "string", required: false },
    },
    async execute(input, ctx) {
      return apiRequest(ctx, "POST", "recipients", input);
    },
  });

  rl.registerAction("recipient.get", {
    access: "read",
    description: "Get a recipient by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `recipients/${pathSegment((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction("recipient.update", {
    access: "write",
    description: "Update a recipient",
    inputSchema: {
      id: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(ctx, "PUT", `recipients/${pathSegment(p.id)}`, p.data);
    },
  });

  // ── Container ────────────────────────────────────────

  rl.registerAction("container.get", {
    access: "read",
    description: "Get a container by type and ID",
    inputSchema: {
      containerType: {
        type: "string",
        required: true,
        description: "workers, teams, or organizations",
      },
      containerId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `containers/${pathSegment(p.containerType)}/${pathSegment(p.containerId)}`,
      );
    },
  });

  rl.registerAction("container.updateTasks", {
    access: "write",
    description: "Update tasks in a container",
    inputSchema: {
      containerType: {
        type: "string",
        required: true,
        description: "workers, teams, or organizations",
      },
      containerId: { type: "string", required: true },
      tasks: {
        type: "object",
        required: true,
        description: "Array of task IDs",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "PUT",
        `containers/${pathSegment(p.containerType)}/${pathSegment(p.containerId)}`,
        { tasks: p.tasks },
      );
    },
  });

  rl.registerAction("team.getTimeEstimates", {
    access: "read",
    description: "Get driver time estimates for a team",
    inputSchema: {
      id: { type: "string", required: true },
      dropoffLocation: {
        type: "string",
        required: false,
        description: "lng,lat",
      },
      pickupLocation: {
        type: "string",
        required: false,
        description: "lng,lat",
      },
    },
    async execute(input, ctx) {
      const { id, ...qs } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `teams/${pathSegment(id)}/estimate`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("team.autoDispatch", {
    access: "write",
    description: "Auto-dispatch tasks for a team",
    inputSchema: {
      id: { type: "string", required: true },
      data: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "POST",
        `teams/${pathSegment(p.id)}/dispatch`,
        p.data ?? {},
      );
    },
  });

  // ── Destination ─────────────────────────────────────

  rl.registerAction("destination.create", {
    access: "write",
    description: "Create a destination",
    inputSchema: {
      address: {
        type: "object",
        required: true,
        description:
          "{ unparsed: string } or { number, street, city, country }",
      },
    },
    async execute(input, ctx) {
      return apiRequest(ctx, "POST", "destinations", input);
    },
  });

  rl.registerAction("destination.get", {
    access: "read",
    description: "Get a destination by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `destinations/${pathSegment((input as Record<string, unknown>).id)}`,
      );
    },
  });
}
