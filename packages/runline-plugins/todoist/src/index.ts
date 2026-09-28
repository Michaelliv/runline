import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { todoistCredential } from "./credentials.js";

function api(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, todoistCredential, "todoist", {
    target: "rest",
    path: endpoint.replace(/^\//, ""),
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

function quickAdd(
  ctx: ActionContext,
  body: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, todoistCredential, "todoist", {
    target: "sync",
    path: "quick/add",
    method: "POST",
    json: body,
  });
}

export default function todoist(rl: RunlinePluginAPI) {
  rl.setName("todoist");
  rl.setVersion("0.1.0");
  rl.setCredential(todoistCredential);
  rl.setConnectionSchema({
    apiToken: {
      type: "string",
      required: true,
      description: "Todoist API token",
      env: "TODOIST_API_TOKEN",
    },
  });

  // ── Task ────────────────────────────────────────────

  rl.registerAction("task.create", {
    access: "write",
    description: "Create a task",
    inputSchema: {
      content: { type: "string", required: true },
      projectId: { type: "string", required: false },
      description: { type: "string", required: false },
      priority: {
        type: "number",
        required: false,
        description: "1 (normal) to 4 (urgent)",
      },
      dueString: { type: "string", required: false },
      dueDate: { type: "string", required: false, description: "YYYY-MM-DD" },
      labels: {
        type: "object",
        required: false,
        description: "Array of label names",
      },
      sectionId: { type: "string", required: false },
      parentId: { type: "string", required: false },
      assigneeId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { content: p.content };
      if (p.projectId) body.project_id = p.projectId;
      if (p.description) body.description = p.description;
      if (p.priority) body.priority = p.priority;
      if (p.dueString) body.due_string = p.dueString;
      if (p.dueDate) body.due_date = p.dueDate;
      if (p.labels) body.labels = p.labels;
      if (p.sectionId) body.section_id = p.sectionId;
      if (p.parentId) body.parent_id = p.parentId;
      if (p.assigneeId) body.assignee_id = p.assigneeId;
      return api(ctx, "POST", "/tasks", body);
    },
  });

  rl.registerAction("task.get", {
    access: "read",
    description: "Get a task by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `/tasks/${pathSegment((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction("task.list", {
    access: "read",
    description: "List tasks",
    inputSchema: {
      projectId: { type: "string", required: false },
      sectionId: { type: "string", required: false },
      label: { type: "string", required: false },
      filter: { type: "string", required: false },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.projectId) qs.project_id = p.projectId;
      if (p.sectionId) qs.section_id = p.sectionId;
      if (p.label) qs.label = p.label;
      if (p.filter) qs.filter = p.filter;
      const data = (await api(
        ctx,
        "GET",
        "/tasks",
        undefined,
        qs,
      )) as unknown[];
      return p.limit ? data.slice(0, p.limit as number) : data;
    },
  });

  rl.registerAction("task.update", {
    access: "write",
    description: "Update a task",
    inputSchema: {
      id: { type: "string", required: true },
      content: { type: "string", required: false },
      description: { type: "string", required: false },
      priority: { type: "number", required: false },
      dueString: { type: "string", required: false },
      dueDate: { type: "string", required: false },
      labels: { type: "object", required: false },
      assigneeId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.content) body.content = fields.content;
      if (fields.description) body.description = fields.description;
      if (fields.priority) body.priority = fields.priority;
      if (fields.dueString) body.due_string = fields.dueString;
      if (fields.dueDate) body.due_date = fields.dueDate;
      if (fields.labels) body.labels = fields.labels;
      if (fields.assigneeId) body.assignee_id = fields.assigneeId;
      return api(ctx, "POST", `/tasks/${pathSegment(id)}`, body);
    },
  });

  rl.registerAction("task.close", {
    access: "write",
    description: "Close (complete) a task",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "POST",
        `/tasks/${pathSegment((input as Record<string, unknown>).id)}/close`,
      );
      return { success: true };
    },
  });

  rl.registerAction("task.reopen", {
    access: "write",
    description: "Reopen a task",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "POST",
        `/tasks/${pathSegment((input as Record<string, unknown>).id)}/reopen`,
      );
      return { success: true };
    },
  });

  rl.registerAction("task.delete", {
    access: "write",
    description: "Delete a task",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `/tasks/${pathSegment((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("task.quickAdd", {
    access: "write",
    description: "Quick add a task using natural language",
    inputSchema: {
      text: {
        type: "string",
        required: true,
        description: 'e.g. "Buy milk @Grocery #shopping tomorrow"',
      },
      note: { type: "string", required: false },
      reminder: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { text: p.text };
      if (p.note) body.note = p.note;
      if (p.reminder) body.reminder = p.reminder;
      return quickAdd(ctx, body);
    },
  });

  // ── Project ─────────────────────────────────────────

  rl.registerAction("project.create", {
    access: "write",
    description: "Create a project",
    inputSchema: {
      name: { type: "string", required: true },
      color: { type: "string", required: false },
      isFavorite: { type: "boolean", required: false },
      parentId: { type: "string", required: false },
      viewStyle: {
        type: "string",
        required: false,
        description: "list or board",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name };
      if (p.color) body.color = p.color;
      if (p.isFavorite) body.is_favorite = true;
      if (p.parentId) body.parent_id = p.parentId;
      if (p.viewStyle) body.view_style = p.viewStyle;
      return api(ctx, "POST", "/projects", body);
    },
  });

  rl.registerAction("project.get", {
    access: "read",
    description: "Get a project",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `/projects/${pathSegment((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction("project.list", {
    access: "read",
    description: "List all projects",
    inputSchema: {},
    async execute(_input, ctx) {
      return api(ctx, "GET", "/projects");
    },
  });

  rl.registerAction("project.update", {
    access: "write",
    description: "Update a project",
    inputSchema: {
      id: { type: "string", required: true },
      name: { type: "string", required: false },
      color: { type: "string", required: false },
      isFavorite: { type: "boolean", required: false },
      viewStyle: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.name) body.name = fields.name;
      if (fields.color) body.color = fields.color;
      if (fields.isFavorite !== undefined) body.is_favorite = fields.isFavorite;
      if (fields.viewStyle) body.view_style = fields.viewStyle;
      return api(ctx, "POST", `/projects/${pathSegment(id)}`, body);
    },
  });

  rl.registerAction("project.delete", {
    access: "write",
    description: "Delete a project",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `/projects/${pathSegment((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("project.archive", {
    access: "write",
    description: "Archive a project",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "POST",
        `/projects/${pathSegment((input as Record<string, unknown>).id)}/archive`,
      );
      return { success: true };
    },
  });

  rl.registerAction("project.unarchive", {
    access: "write",
    description: "Unarchive a project",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "POST",
        `/projects/${pathSegment((input as Record<string, unknown>).id)}/unarchive`,
      );
      return { success: true };
    },
  });

  rl.registerAction("project.getCollaborators", {
    access: "read",
    description: "Get project collaborators",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `/projects/${pathSegment((input as Record<string, unknown>).id)}/collaborators`,
      );
    },
  });

  // ── Section ─────────────────────────────────────────

  rl.registerAction("section.create", {
    access: "write",
    description: "Create a section",
    inputSchema: {
      projectId: { type: "string", required: true },
      name: { type: "string", required: true },
      order: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(ctx, "POST", "/sections", {
        project_id: p.projectId,
        name: p.name,
        ...(p.order ? { order: p.order } : {}),
      });
    },
  });

  rl.registerAction("section.get", {
    access: "read",
    description: "Get a section",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `/sections/${pathSegment((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction("section.list", {
    access: "read",
    description: "List sections",
    inputSchema: { projectId: { type: "string", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.projectId)
        qs.project_id = (input as Record<string, unknown>).projectId;
      return api(ctx, "GET", "/sections", undefined, qs);
    },
  });

  rl.registerAction("section.update", {
    access: "write",
    description: "Update a section",
    inputSchema: {
      id: { type: "string", required: true },
      name: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(ctx, "POST", `/sections/${pathSegment(p.id)}`, {
        name: p.name,
      });
    },
  });

  rl.registerAction("section.delete", {
    access: "write",
    description: "Delete a section",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `/sections/${pathSegment((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  // ── Comment ─────────────────────────────────────────

  rl.registerAction("comment.create", {
    access: "write",
    description: "Create a comment on a task",
    inputSchema: {
      taskId: { type: "string", required: true },
      content: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(ctx, "POST", "/comments", {
        task_id: p.taskId,
        content: p.content,
      });
    },
  });

  rl.registerAction("comment.get", {
    access: "read",
    description: "Get a comment",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `/comments/${pathSegment((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction("comment.list", {
    access: "read",
    description: "List comments",
    inputSchema: {
      taskId: { type: "string", required: false },
      projectId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.taskId) qs.task_id = p.taskId;
      if (p.projectId) qs.project_id = p.projectId;
      return api(ctx, "GET", "/comments", undefined, qs);
    },
  });

  rl.registerAction("comment.update", {
    access: "write",
    description: "Update a comment",
    inputSchema: {
      id: { type: "string", required: true },
      content: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(ctx, "POST", `/comments/${pathSegment(p.id)}`, {
        content: p.content,
      });
    },
  });

  rl.registerAction("comment.delete", {
    access: "write",
    description: "Delete a comment",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `/comments/${pathSegment((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  // ── Label ───────────────────────────────────────────

  rl.registerAction("label.create", {
    access: "write",
    description: "Create a label",
    inputSchema: {
      name: { type: "string", required: true },
      color: { type: "string", required: false },
      order: { type: "number", required: false },
      isFavorite: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name };
      if (p.color) body.color = p.color;
      if (p.order) body.order = p.order;
      if (p.isFavorite) body.is_favorite = true;
      return api(ctx, "POST", "/labels", body);
    },
  });

  rl.registerAction("label.get", {
    access: "read",
    description: "Get a label",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `/labels/${pathSegment((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction("label.list", {
    access: "read",
    description: "List all labels",
    inputSchema: {},
    async execute(_input, ctx) {
      return api(ctx, "GET", "/labels");
    },
  });

  rl.registerAction("label.update", {
    access: "write",
    description: "Update a label",
    inputSchema: {
      id: { type: "string", required: true },
      name: { type: "string", required: false },
      color: { type: "string", required: false },
      order: { type: "number", required: false },
      isFavorite: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.name) body.name = fields.name;
      if (fields.color) body.color = fields.color;
      if (fields.order) body.order = fields.order;
      if (fields.isFavorite !== undefined) body.is_favorite = fields.isFavorite;
      return api(ctx, "POST", `/labels/${pathSegment(id)}`, body);
    },
  });

  rl.registerAction("label.delete", {
    access: "write",
    description: "Delete a label",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `/labels/${pathSegment((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });
}
