import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.todoist.com/rest/v2";
const SYNC_BASE = "https://api.todoist.com/sync/v9";

async function api(token: string, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (res.status === 204) return { success: true };
  if (!res.ok) throw new Error(`Todoist error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : { success: true };
}

async function syncApi(token: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${SYNC_BASE}/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Todoist Sync error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function quickAdd(token: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${SYNC_BASE}/quick/add`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Todoist error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function todoist(rl: RunlinePluginAPI) {
  rl.setName("todoist");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({ apiToken: { type: "string", required: true, description: "Todoist API token", env: "TODOIST_API_TOKEN" } });
  const t = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiToken as string;

  // ── Task ────────────────────────────────────────────

  rl.registerAction("task.create", { description: "Create a task",
    inputSchema: { content: { type: "string", required: true }, projectId: { type: "string", required: false }, description: { type: "string", required: false }, priority: { type: "number", required: false, description: "1 (normal) to 4 (urgent)" }, dueString: { type: "string", required: false }, dueDate: { type: "string", required: false, description: "YYYY-MM-DD" }, labels: { type: "object", required: false, description: "Array of label names" }, sectionId: { type: "string", required: false }, parentId: { type: "string", required: false }, assigneeId: { type: "string", required: false } },
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
      return api(t(ctx), "POST", "/tasks", body);
    } });

  rl.registerAction("task.get", { description: "Get a task by ID", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", `/tasks/${(input as Record<string, unknown>).id}`); } });

  rl.registerAction("task.list", { description: "List tasks",
    inputSchema: { projectId: { type: "string", required: false }, sectionId: { type: "string", required: false }, label: { type: "string", required: false }, filter: { type: "string", required: false }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.projectId) qs.project_id = p.projectId;
      if (p.sectionId) qs.section_id = p.sectionId;
      if (p.label) qs.label = p.label;
      if (p.filter) qs.filter = p.filter;
      const data = (await api(t(ctx), "GET", "/tasks", undefined, qs)) as unknown[];
      return p.limit ? data.slice(0, p.limit as number) : data;
    } });

  rl.registerAction("task.update", { description: "Update a task",
    inputSchema: { id: { type: "string", required: true }, content: { type: "string", required: false }, description: { type: "string", required: false }, priority: { type: "number", required: false }, dueString: { type: "string", required: false }, dueDate: { type: "string", required: false }, labels: { type: "object", required: false }, assigneeId: { type: "string", required: false } },
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
      return api(t(ctx), "POST", `/tasks/${id}`, body);
    } });

  rl.registerAction("task.close", { description: "Close (complete) a task", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { await api(t(ctx), "POST", `/tasks/${(input as Record<string, unknown>).id}/close`); return { success: true }; } });

  rl.registerAction("task.reopen", { description: "Reopen a task", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { await api(t(ctx), "POST", `/tasks/${(input as Record<string, unknown>).id}/reopen`); return { success: true }; } });

  rl.registerAction("task.delete", { description: "Delete a task", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { await api(t(ctx), "DELETE", `/tasks/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  rl.registerAction("task.quickAdd", { description: "Quick add a task using natural language",
    inputSchema: { text: { type: "string", required: true, description: 'e.g. "Buy milk @Grocery #shopping tomorrow"' }, note: { type: "string", required: false }, reminder: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { text: p.text };
      if (p.note) body.note = p.note;
      if (p.reminder) body.reminder = p.reminder;
      return quickAdd(t(ctx), body);
    } });

  // ── Project ─────────────────────────────────────────

  rl.registerAction("project.create", { description: "Create a project",
    inputSchema: { name: { type: "string", required: true }, color: { type: "string", required: false }, isFavorite: { type: "boolean", required: false }, parentId: { type: "string", required: false }, viewStyle: { type: "string", required: false, description: "list or board" } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name };
      if (p.color) body.color = p.color;
      if (p.isFavorite) body.is_favorite = true;
      if (p.parentId) body.parent_id = p.parentId;
      if (p.viewStyle) body.view_style = p.viewStyle;
      return api(t(ctx), "POST", "/projects", body);
    } });

  rl.registerAction("project.get", { description: "Get a project", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", `/projects/${(input as Record<string, unknown>).id}`); } });

  rl.registerAction("project.list", { description: "List all projects", inputSchema: {},
    async execute(_input, ctx) { return api(t(ctx), "GET", "/projects"); } });

  rl.registerAction("project.update", { description: "Update a project",
    inputSchema: { id: { type: "string", required: true }, name: { type: "string", required: false }, color: { type: "string", required: false }, isFavorite: { type: "boolean", required: false }, viewStyle: { type: "string", required: false } },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.name) body.name = fields.name;
      if (fields.color) body.color = fields.color;
      if (fields.isFavorite !== undefined) body.is_favorite = fields.isFavorite;
      if (fields.viewStyle) body.view_style = fields.viewStyle;
      return api(t(ctx), "POST", `/projects/${id}`, body);
    } });

  rl.registerAction("project.delete", { description: "Delete a project", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { await api(t(ctx), "DELETE", `/projects/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  rl.registerAction("project.archive", { description: "Archive a project", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { await api(t(ctx), "POST", `/projects/${(input as Record<string, unknown>).id}/archive`); return { success: true }; } });

  rl.registerAction("project.unarchive", { description: "Unarchive a project", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { await api(t(ctx), "POST", `/projects/${(input as Record<string, unknown>).id}/unarchive`); return { success: true }; } });

  rl.registerAction("project.getCollaborators", { description: "Get project collaborators", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", `/projects/${(input as Record<string, unknown>).id}/collaborators`); } });

  // ── Section ─────────────────────────────────────────

  rl.registerAction("section.create", { description: "Create a section",
    inputSchema: { projectId: { type: "string", required: true }, name: { type: "string", required: true }, order: { type: "number", required: false } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(t(ctx), "POST", "/sections", { project_id: p.projectId, name: p.name, ...(p.order ? { order: p.order } : {}) }); } });

  rl.registerAction("section.get", { description: "Get a section", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", `/sections/${(input as Record<string, unknown>).id}`); } });

  rl.registerAction("section.list", { description: "List sections",
    inputSchema: { projectId: { type: "string", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.projectId) qs.project_id = (input as Record<string, unknown>).projectId;
      return api(t(ctx), "GET", "/sections", undefined, qs);
    } });

  rl.registerAction("section.update", { description: "Update a section", inputSchema: { id: { type: "string", required: true }, name: { type: "string", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(t(ctx), "POST", `/sections/${p.id}`, { name: p.name }); } });

  rl.registerAction("section.delete", { description: "Delete a section", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { await api(t(ctx), "DELETE", `/sections/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  // ── Comment ─────────────────────────────────────────

  rl.registerAction("comment.create", { description: "Create a comment on a task",
    inputSchema: { taskId: { type: "string", required: true }, content: { type: "string", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(t(ctx), "POST", "/comments", { task_id: p.taskId, content: p.content }); } });

  rl.registerAction("comment.get", { description: "Get a comment", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", `/comments/${(input as Record<string, unknown>).id}`); } });

  rl.registerAction("comment.list", { description: "List comments",
    inputSchema: { taskId: { type: "string", required: false }, projectId: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.taskId) qs.task_id = p.taskId;
      if (p.projectId) qs.project_id = p.projectId;
      return api(t(ctx), "GET", "/comments", undefined, qs);
    } });

  rl.registerAction("comment.update", { description: "Update a comment", inputSchema: { id: { type: "string", required: true }, content: { type: "string", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(t(ctx), "POST", `/comments/${p.id}`, { content: p.content }); } });

  rl.registerAction("comment.delete", { description: "Delete a comment", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { await api(t(ctx), "DELETE", `/comments/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  // ── Label ───────────────────────────────────────────

  rl.registerAction("label.create", { description: "Create a label",
    inputSchema: { name: { type: "string", required: true }, color: { type: "string", required: false }, order: { type: "number", required: false }, isFavorite: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name };
      if (p.color) body.color = p.color;
      if (p.order) body.order = p.order;
      if (p.isFavorite) body.is_favorite = true;
      return api(t(ctx), "POST", "/labels", body);
    } });

  rl.registerAction("label.get", { description: "Get a label", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return api(t(ctx), "GET", `/labels/${(input as Record<string, unknown>).id}`); } });

  rl.registerAction("label.list", { description: "List all labels", inputSchema: {},
    async execute(_input, ctx) { return api(t(ctx), "GET", "/labels"); } });

  rl.registerAction("label.update", { description: "Update a label",
    inputSchema: { id: { type: "string", required: true }, name: { type: "string", required: false }, color: { type: "string", required: false }, order: { type: "number", required: false }, isFavorite: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.name) body.name = fields.name;
      if (fields.color) body.color = fields.color;
      if (fields.order) body.order = fields.order;
      if (fields.isFavorite !== undefined) body.is_favorite = fields.isFavorite;
      return api(t(ctx), "POST", `/labels/${id}`, body);
    } });

  rl.registerAction("label.delete", { description: "Delete a label", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { await api(t(ctx), "DELETE", `/labels/${(input as Record<string, unknown>).id}`); return { success: true }; } });
}
