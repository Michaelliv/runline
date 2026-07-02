import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.clockify.me/api/v1";

async function apiRequest(
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  ) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Clockify API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return { success: true };
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return { success: true };
}

async function paginateAll(
  apiKey: string,
  endpoint: string,
  qs?: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let page = 1;
  const size = 50;
  while (true) {
    const data = (await apiRequest(apiKey, "GET", endpoint, undefined, {
      ...qs,
      page,
      "page-size": size,
    })) as unknown[];
    if (!Array.isArray(data)) break;
    results.push(...data);
    if (limit && results.length >= limit) return results.slice(0, limit);
    if (data.length < size) break;
    page++;
  }
  return results;
}

function getKey(ctx: {
  connection: { config: Record<string, unknown> };
}): string {
  return ctx.connection.config.apiKey as string;
}

export default function clockify(rl: RunlinePluginAPI) {
  rl.setName("clockify");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Clockify API key",
      env: "CLOCKIFY_API_KEY",
    },
  });

  // ── Client ──────────────────────────────────────────

  rl.registerAction("client.create", {
    access: "write",
    description: "Create a client",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      name: { type: "string", required: true, description: "Client name" },
    },
    async execute(input, ctx) {
      const { workspaceId, name } = input as {
        workspaceId: string;
        name: string;
      };
      return apiRequest(
        getKey(ctx),
        "POST",
        `workspaces/${workspaceId}/clients`,
        { name },
      );
    },
  });

  rl.registerAction("client.get", {
    access: "read",
    description: "Get a client",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      clientId: { type: "string", required: true, description: "Client ID" },
    },
    async execute(input, ctx) {
      const { workspaceId, clientId } = input as {
        workspaceId: string;
        clientId: string;
      };
      return apiRequest(
        getKey(ctx),
        "GET",
        `workspaces/${workspaceId}/clients/${clientId}`,
      );
    },
  });

  rl.registerAction("client.list", {
    access: "read",
    description: "List clients in a workspace",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      name: { type: "string", required: false, description: "Filter by name" },
      archived: {
        type: "boolean",
        required: false,
        description: "Include archived",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { workspaceId, name, archived, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (name) qs.name = name;
      if (archived !== undefined) qs.archived = archived;
      return paginateAll(
        getKey(ctx),
        `workspaces/${workspaceId}/clients`,
        qs,
        limit as number | undefined,
      );
    },
  });

  rl.registerAction("client.update", {
    access: "write",
    description: "Update a client",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      clientId: { type: "string", required: true, description: "Client ID" },
      name: { type: "string", required: true, description: "Client name" },
      archived: { type: "boolean", required: false, description: "Archived" },
    },
    async execute(input, ctx) {
      const { workspaceId, clientId, ...body } = input as Record<
        string,
        unknown
      >;
      return apiRequest(
        getKey(ctx),
        "PUT",
        `workspaces/${workspaceId}/clients/${clientId}`,
        body,
      );
    },
  });

  rl.registerAction("client.delete", {
    access: "write",
    description: "Delete a client",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      clientId: { type: "string", required: true, description: "Client ID" },
    },
    async execute(input, ctx) {
      const { workspaceId, clientId } = input as {
        workspaceId: string;
        clientId: string;
      };
      await apiRequest(
        getKey(ctx),
        "DELETE",
        `workspaces/${workspaceId}/clients/${clientId}`,
      );
      return { success: true };
    },
  });

  // ── Project ─────────────────────────────────────────

  rl.registerAction("project.create", {
    access: "write",
    description: "Create a project",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      name: { type: "string", required: true, description: "Project name" },
      clientId: { type: "string", required: false, description: "Client ID" },
      isPublic: {
        type: "boolean",
        required: false,
        description: "Public project",
      },
      billable: { type: "boolean", required: false, description: "Billable" },
      color: { type: "string", required: false, description: "Color hex" },
      note: { type: "string", required: false, description: "Note" },
    },
    async execute(input, ctx) {
      const { workspaceId, ...body } = input as Record<string, unknown>;
      return apiRequest(
        getKey(ctx),
        "POST",
        `workspaces/${workspaceId}/projects`,
        body,
      );
    },
  });

  rl.registerAction("project.get", {
    access: "read",
    description: "Get a project",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      projectId: { type: "string", required: true, description: "Project ID" },
    },
    async execute(input, ctx) {
      const { workspaceId, projectId } = input as {
        workspaceId: string;
        projectId: string;
      };
      return apiRequest(
        getKey(ctx),
        "GET",
        `workspaces/${workspaceId}/projects/${projectId}`,
      );
    },
  });

  rl.registerAction("project.list", {
    access: "read",
    description: "List projects in a workspace",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      name: { type: "string", required: false, description: "Filter by name" },
      archived: {
        type: "boolean",
        required: false,
        description: "Include archived",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { workspaceId, name, archived, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (name) qs.name = name;
      if (archived !== undefined) qs.archived = archived;
      return paginateAll(
        getKey(ctx),
        `workspaces/${workspaceId}/projects`,
        qs,
        limit as number | undefined,
      );
    },
  });

  rl.registerAction("project.update", {
    access: "write",
    description: "Update a project",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      projectId: { type: "string", required: true, description: "Project ID" },
      name: { type: "string", required: false, description: "Name" },
      clientId: { type: "string", required: false, description: "Client ID" },
      isPublic: { type: "boolean", required: false, description: "Public" },
      billable: { type: "boolean", required: false, description: "Billable" },
      color: { type: "string", required: false, description: "Color" },
      note: { type: "string", required: false, description: "Note" },
      archived: { type: "boolean", required: false, description: "Archived" },
    },
    async execute(input, ctx) {
      const { workspaceId, projectId, ...body } = input as Record<
        string,
        unknown
      >;
      return apiRequest(
        getKey(ctx),
        "PUT",
        `workspaces/${workspaceId}/projects/${projectId}`,
        body,
      );
    },
  });

  rl.registerAction("project.delete", {
    access: "write",
    description: "Delete a project",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      projectId: { type: "string", required: true, description: "Project ID" },
    },
    async execute(input, ctx) {
      const { workspaceId, projectId } = input as {
        workspaceId: string;
        projectId: string;
      };
      await apiRequest(
        getKey(ctx),
        "DELETE",
        `workspaces/${workspaceId}/projects/${projectId}`,
      );
      return { success: true };
    },
  });

  // ── Tag ─────────────────────────────────────────────

  rl.registerAction("tag.create", {
    access: "write",
    description: "Create a tag",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      name: { type: "string", required: true, description: "Tag name" },
    },
    async execute(input, ctx) {
      const { workspaceId, name } = input as {
        workspaceId: string;
        name: string;
      };
      return apiRequest(getKey(ctx), "POST", `workspaces/${workspaceId}/tags`, {
        name,
      });
    },
  });

  rl.registerAction("tag.list", {
    access: "read",
    description: "List tags in a workspace",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      name: { type: "string", required: false, description: "Filter by name" },
      archived: {
        type: "boolean",
        required: false,
        description: "Include archived",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { workspaceId, name, archived, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (name) qs.name = name;
      if (archived !== undefined) qs.archived = archived;
      return paginateAll(
        getKey(ctx),
        `workspaces/${workspaceId}/tags`,
        qs,
        limit as number | undefined,
      );
    },
  });

  rl.registerAction("tag.update", {
    access: "write",
    description: "Update a tag",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      tagId: { type: "string", required: true, description: "Tag ID" },
      name: { type: "string", required: false, description: "Name" },
      archived: { type: "boolean", required: false, description: "Archived" },
    },
    async execute(input, ctx) {
      const { workspaceId, tagId, ...body } = input as Record<string, unknown>;
      return apiRequest(
        getKey(ctx),
        "PUT",
        `workspaces/${workspaceId}/tags/${tagId}`,
        body,
      );
    },
  });

  rl.registerAction("tag.delete", {
    access: "write",
    description: "Delete a tag",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      tagId: { type: "string", required: true, description: "Tag ID" },
    },
    async execute(input, ctx) {
      const { workspaceId, tagId } = input as {
        workspaceId: string;
        tagId: string;
      };
      await apiRequest(
        getKey(ctx),
        "DELETE",
        `workspaces/${workspaceId}/tags/${tagId}`,
      );
      return { success: true };
    },
  });

  // ── Task ────────────────────────────────────────────

  rl.registerAction("task.create", {
    access: "write",
    description: "Create a task in a project",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      projectId: { type: "string", required: true, description: "Project ID" },
      name: { type: "string", required: true, description: "Task name" },
      assigneeIds: {
        type: "array",
        required: false,
        description: "Assignee user IDs",
      },
      estimate: {
        type: "string",
        required: false,
        description: "Estimate (HH:MM format)",
      },
      status: {
        type: "string",
        required: false,
        description: "Status: ACTIVE or DONE",
      },
    },
    async execute(input, ctx) {
      const { workspaceId, projectId, estimate, ...body } = input as Record<
        string,
        unknown
      >;
      if (estimate) {
        const [h, m] = (estimate as string).split(":");
        body.estimate = `PT${h}H${m}M`;
      }
      return apiRequest(
        getKey(ctx),
        "POST",
        `workspaces/${workspaceId}/projects/${projectId}/tasks`,
        body,
      );
    },
  });

  rl.registerAction("task.get", {
    access: "read",
    description: "Get a task",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      projectId: { type: "string", required: true, description: "Project ID" },
      taskId: { type: "string", required: true, description: "Task ID" },
    },
    async execute(input, ctx) {
      const { workspaceId, projectId, taskId } = input as Record<
        string,
        string
      >;
      return apiRequest(
        getKey(ctx),
        "GET",
        `workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`,
      );
    },
  });

  rl.registerAction("task.list", {
    access: "read",
    description: "List tasks in a project",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      projectId: { type: "string", required: true, description: "Project ID" },
      isActive: {
        type: "boolean",
        required: false,
        description: "Filter active tasks",
      },
      name: { type: "string", required: false, description: "Filter by name" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { workspaceId, projectId, isActive, name, limit } = (input ??
        {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (isActive !== undefined) qs["is-active"] = isActive;
      if (name) qs.name = name;
      if (limit) {
        qs["page-size"] = limit;
        return apiRequest(
          getKey(ctx),
          "GET",
          `workspaces/${workspaceId}/projects/${projectId}/tasks`,
          undefined,
          qs,
        );
      }
      return paginateAll(
        getKey(ctx),
        `workspaces/${workspaceId}/projects/${projectId}/tasks`,
        qs,
      );
    },
  });

  rl.registerAction("task.update", {
    access: "write",
    description: "Update a task",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      projectId: { type: "string", required: true, description: "Project ID" },
      taskId: { type: "string", required: true, description: "Task ID" },
      name: { type: "string", required: false, description: "Name" },
      assigneeIds: {
        type: "array",
        required: false,
        description: "Assignee IDs",
      },
      estimate: {
        type: "string",
        required: false,
        description: "Estimate (HH:MM)",
      },
      status: { type: "string", required: false, description: "Status" },
    },
    async execute(input, ctx) {
      const { workspaceId, projectId, taskId, estimate, ...body } =
        input as Record<string, unknown>;
      if (estimate) {
        const [h, m] = (estimate as string).split(":");
        body.estimate = `PT${h}H${m}M`;
      }
      return apiRequest(
        getKey(ctx),
        "PUT",
        `workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`,
        body,
      );
    },
  });

  rl.registerAction("task.delete", {
    access: "write",
    description: "Delete a task",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      projectId: { type: "string", required: true, description: "Project ID" },
      taskId: { type: "string", required: true, description: "Task ID" },
    },
    async execute(input, ctx) {
      const { workspaceId, projectId, taskId } = input as Record<
        string,
        string
      >;
      await apiRequest(
        getKey(ctx),
        "DELETE",
        `workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`,
      );
      return { success: true };
    },
  });

  // ── Time Entry ──────────────────────────────────────

  rl.registerAction("timeEntry.create", {
    access: "write",
    description: "Create a time entry",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      start: {
        type: "string",
        required: true,
        description: "Start time (ISO 8601)",
      },
      end: {
        type: "string",
        required: false,
        description: "End time (ISO 8601)",
      },
      description: {
        type: "string",
        required: false,
        description: "Description",
      },
      projectId: { type: "string", required: false, description: "Project ID" },
      taskId: { type: "string", required: false, description: "Task ID" },
      tagIds: { type: "array", required: false, description: "Tag IDs" },
      billable: { type: "boolean", required: false, description: "Billable" },
    },
    async execute(input, ctx) {
      const { workspaceId, ...body } = input as Record<string, unknown>;
      return apiRequest(
        getKey(ctx),
        "POST",
        `workspaces/${workspaceId}/time-entries`,
        body,
      );
    },
  });

  rl.registerAction("timeEntry.get", {
    access: "read",
    description: "Get a time entry",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      timeEntryId: {
        type: "string",
        required: true,
        description: "Time entry ID",
      },
    },
    async execute(input, ctx) {
      const { workspaceId, timeEntryId } = input as {
        workspaceId: string;
        timeEntryId: string;
      };
      return apiRequest(
        getKey(ctx),
        "GET",
        `workspaces/${workspaceId}/time-entries/${timeEntryId}`,
      );
    },
  });

  rl.registerAction("timeEntry.update", {
    access: "write",
    description: "Update a time entry",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      timeEntryId: {
        type: "string",
        required: true,
        description: "Time entry ID",
      },
      start: { type: "string", required: false, description: "Start time" },
      end: { type: "string", required: false, description: "End time" },
      description: {
        type: "string",
        required: false,
        description: "Description",
      },
      projectId: { type: "string", required: false, description: "Project ID" },
      taskId: { type: "string", required: false, description: "Task ID" },
      tagIds: { type: "array", required: false, description: "Tag IDs" },
      billable: { type: "boolean", required: false, description: "Billable" },
    },
    async execute(input, ctx) {
      const { workspaceId, timeEntryId, ...body } = input as Record<
        string,
        unknown
      >;
      // start is required by API — fetch current if not set
      if (!body.start) {
        const current = (await apiRequest(
          getKey(ctx),
          "GET",
          `workspaces/${workspaceId}/time-entries/${timeEntryId}`,
        )) as Record<string, unknown>;
        const interval = current.timeInterval as Record<string, unknown>;
        body.start = interval.start;
      }
      return apiRequest(
        getKey(ctx),
        "PUT",
        `workspaces/${workspaceId}/time-entries/${timeEntryId}`,
        body,
      );
    },
  });

  rl.registerAction("timeEntry.delete", {
    access: "write",
    description: "Delete a time entry",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      timeEntryId: {
        type: "string",
        required: true,
        description: "Time entry ID",
      },
    },
    async execute(input, ctx) {
      const { workspaceId, timeEntryId } = input as {
        workspaceId: string;
        timeEntryId: string;
      };
      await apiRequest(
        getKey(ctx),
        "DELETE",
        `workspaces/${workspaceId}/time-entries/${timeEntryId}`,
      );
      return { success: true };
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.list", {
    access: "read",
    description: "List users in a workspace",
    inputSchema: {
      workspaceId: {
        type: "string",
        required: true,
        description: "Workspace ID",
      },
      email: {
        type: "string",
        required: false,
        description: "Filter by email",
      },
      status: {
        type: "string",
        required: false,
        description: "Filter by status: ACTIVE, PENDING, DECLINED",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { workspaceId, email, status, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (email) qs.email = email;
      if (status) qs.status = status;
      return paginateAll(
        getKey(ctx),
        `workspaces/${workspaceId}/users`,
        qs,
        limit as number | undefined,
      );
    },
  });

  // ── Workspace ───────────────────────────────────────

  rl.registerAction("workspace.list", {
    access: "read",
    description: "List all workspaces",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await apiRequest(
        getKey(ctx),
        "GET",
        "workspaces",
      )) as unknown[];
      if (limit) return data.slice(0, limit);
      return data;
    },
  });
}
