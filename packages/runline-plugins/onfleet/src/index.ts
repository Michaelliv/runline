import type { RunlinePluginAPI } from "runline";

const BASE = "https://onfleet.com/api/v2";

async function apiRequest(
  apiKey: string,
  method: string,
  endpoint: string,
  body?: unknown,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}/${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:`)}`,
      "Content-Type": "application/json",
      "User-Agent": "runline-onfleet",
    },
  };
  if (body !== undefined && method !== "GET") init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok)
    throw new Error(`Onfleet error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

function registerCrud(
  rl: RunlinePluginAPI,
  resource: string,
  plural: string,
  key: (ctx: { connection: { config: Record<string, unknown> } }) => string,
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
      return apiRequest(key(ctx), "POST", plural, input);
    },
  });

  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource} by ID`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        key(ctx),
        "GET",
        `${plural}/${(input as Record<string, unknown>).id}`,
      );
    },
  });

  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `List ${plural}`,
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const data = (await apiRequest(key(ctx), "GET", plural)) as unknown[];
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
      return apiRequest(key(ctx), "PUT", `${plural}/${p.id}`, p.data);
    },
  });

  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        key(ctx),
        "DELETE",
        `${plural}/${(input as Record<string, unknown>).id}`,
      );
      return { success: true };
    },
  });
}

export default function onfleet(rl: RunlinePluginAPI) {
  rl.setName("onfleet");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Onfleet API key",
      env: "ONFLEET_API_KEY",
    },
  });
  const key = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.apiKey as string;

  // ── Organization ────────────────────────────────────

  rl.registerAction("organization.get", {
    access: "read",
    description: "Get organization details",
    inputSchema: {},
    async execute(_input, ctx) {
      return apiRequest(key(ctx), "GET", "organization");
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
      return apiRequest(key(ctx), "POST", "tasks", input);
    },
  });

  rl.registerAction("task.get", {
    access: "read",
    description: "Get a task by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const id = (input as Record<string, unknown>).id as string;
      const path = id.length <= 8 ? `tasks/shortId/${id}` : `tasks/${id}`;
      return apiRequest(key(ctx), "GET", path);
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
        key(ctx),
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
      return apiRequest(key(ctx), "PUT", `tasks/${p.id}`, p.data);
    },
  });

  rl.registerAction("task.delete", {
    access: "write",
    description: "Delete a task",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        key(ctx),
        "DELETE",
        `tasks/${(input as Record<string, unknown>).id}`,
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
      await apiRequest(key(ctx), "POST", `tasks/${p.id}/complete`, body);
      return { success: true };
    },
  });

  // ── Worker ──────────────────────────────────────────

  registerCrud(rl, "worker", "workers", key, {
    name: { type: "string", required: true },
    phone: { type: "string", required: true },
    teams: { type: "object", required: true, description: "Array of team IDs" },
  });

  // ── Admin ───────────────────────────────────────────

  registerCrud(rl, "admin", "admins", key, {
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
      return apiRequest(key(ctx), "POST", "hubs", input);
    },
  });

  rl.registerAction("hub.list", {
    access: "read",
    description: "List hubs",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const data = (await apiRequest(key(ctx), "GET", "hubs")) as unknown[];
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
      return apiRequest(key(ctx), "PUT", `hubs/${p.id}`, p.data);
    },
  });

  // ── Team ────────────────────────────────────────────

  registerCrud(rl, "team", "teams", key, {
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
      return apiRequest(key(ctx), "POST", "recipients", input);
    },
  });

  rl.registerAction("recipient.get", {
    access: "read",
    description: "Get a recipient by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        key(ctx),
        "GET",
        `recipients/${(input as Record<string, unknown>).id}`,
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
      return apiRequest(key(ctx), "PUT", `recipients/${p.id}`, p.data);
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
        key(ctx),
        "GET",
        `containers/${p.containerType}/${p.containerId}`,
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
        key(ctx),
        "PUT",
        `containers/${p.containerType}/${p.containerId}`,
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
      return apiRequest(key(ctx), "GET", `teams/${id}/estimate`, undefined, qs);
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
        key(ctx),
        "POST",
        `teams/${p.id}/dispatch`,
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
      return apiRequest(key(ctx), "POST", "destinations", input);
    },
  });

  rl.registerAction("destination.get", {
    access: "read",
    description: "Get a destination by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        key(ctx),
        "GET",
        `destinations/${(input as Record<string, unknown>).id}`,
      );
    },
  });
}
