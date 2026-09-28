import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialJson,
  pathSegment,
  pathWithin,
} from "../../_shared/credentials.js";
import { asanaCredential } from "./credentials.js";

async function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const json = (await credentialJson(ctx, asanaCredential, "asana", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: { data: body } }
      : {}),
  })) as Record<string, unknown>;
  return json.data ?? json;
}

async function paginateAll(
  ctx: ActionContext,
  path: string,
  qs?: Record<string, unknown>,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let page: { path: string; query?: Record<string, unknown> } = {
    path,
    query: { limit: 100, ...qs },
  };

  while (true) {
    const json = (await credentialJson(ctx, asanaCredential, "asana", {
      target: "api",
      ...page,
    })) as Record<string, unknown>;
    const data = (json.data as unknown[]) ?? [];
    results.push(...data);

    if (limit && results.length >= limit) return results.slice(0, limit);

    const nextPage = json.next_page as { uri?: string } | null;
    if (!nextPage?.uri) break;
    page = { path: pathWithin(ctx, asanaCredential, "api", nextPage.uri) };
  }

  return results;
}

export default function asana(rl: RunlinePluginAPI) {
  rl.setName("asana");
  rl.setVersion("0.1.0");
  rl.setCredential(asanaCredential);

  rl.setConnectionSchema({
    token: {
      type: "string",
      required: true,
      description: "Asana personal access token",
      env: "ASANA_TOKEN",
    },
  });

  // ── Task ────────────────────────────────────────────

  rl.registerAction("task.create", {
    access: "write",
    description: "Create a new task",
    inputSchema: {
      name: { type: "string", required: true, description: "Task name" },
      workspace: {
        type: "string",
        required: true,
        description: "Workspace GID",
      },
      assignee: {
        type: "string",
        required: false,
        description: "Assignee GID",
      },
      projects: {
        type: "array",
        required: false,
        description: "Array of project GIDs",
      },
      notes: { type: "string", required: false, description: "Task notes" },
      dueOn: {
        type: "string",
        required: false,
        description: "Due date (YYYY-MM-DD)",
      },
      completed: {
        type: "boolean",
        required: false,
        description: "Mark as completed",
      },
    },
    async execute(input, ctx) {
      const {
        name,
        workspace,
        assignee,
        projects,
        notes,
        dueOn,
        completed,
        ...rest
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name, workspace, ...rest };
      if (assignee) body.assignee = assignee;
      if (projects) body.projects = projects;
      if (notes) body.notes = notes;
      if (dueOn) body.due_on = dueOn;
      if (completed !== undefined) body.completed = completed;
      return apiRequest(ctx, "POST", "tasks", body);
    },
  });

  rl.registerAction("task.get", {
    access: "read",
    description: "Get a task by ID",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task GID" },
    },
    async execute(input, ctx) {
      const { taskId } = input as { taskId: string };
      return apiRequest(ctx, "GET", `tasks/${pathSegment(taskId)}`);
    },
  });

  rl.registerAction("task.list", {
    access: "read",
    description:
      "List tasks (requires project, section, or workspace+assignee filter)",
    inputSchema: {
      project: { type: "string", required: false, description: "Project GID" },
      section: { type: "string", required: false, description: "Section GID" },
      workspace: {
        type: "string",
        required: false,
        description: "Workspace GID",
      },
      assignee: {
        type: "string",
        required: false,
        description: "Assignee GID (required with workspace)",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { project, section, workspace, assignee, limit } = (input ??
        {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (project) qs.project = project;
      if (section) qs.section = section;
      if (workspace) qs.workspace = workspace;
      if (assignee) qs.assignee = assignee;
      return paginateAll(ctx, "tasks", qs, limit as number | undefined);
    },
  });

  rl.registerAction("task.update", {
    access: "write",
    description: "Update a task",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task GID" },
      name: { type: "string", required: false, description: "Task name" },
      notes: { type: "string", required: false, description: "Task notes" },
      assignee: {
        type: "string",
        required: false,
        description: "Assignee GID",
      },
      dueOn: {
        type: "string",
        required: false,
        description: "Due date (YYYY-MM-DD)",
      },
      completed: {
        type: "boolean",
        required: false,
        description: "Mark as completed",
      },
    },
    async execute(input, ctx) {
      const { taskId, dueOn, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...fields };
      if (dueOn) body.due_on = dueOn;
      return apiRequest(ctx, "PUT", `tasks/${pathSegment(taskId)}`, body);
    },
  });

  rl.registerAction("task.delete", {
    access: "write",
    description: "Delete a task",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task GID" },
    },
    async execute(input, ctx) {
      const { taskId } = input as { taskId: string };
      await apiRequest(ctx, "DELETE", `tasks/${pathSegment(taskId)}`);
      return { success: true };
    },
  });

  rl.registerAction("task.move", {
    access: "write",
    description: "Move a task to a section",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task GID" },
      sectionId: {
        type: "string",
        required: true,
        description: "Section GID to move into",
      },
    },
    async execute(input, ctx) {
      const { taskId, sectionId } = input as {
        taskId: string;
        sectionId: string;
      };
      await apiRequest(
        ctx,
        "POST",
        `sections/${pathSegment(sectionId)}/addTask`,
        {
          task: taskId,
        },
      );
      return { success: true };
    },
  });

  rl.registerAction("task.search", {
    access: "read",
    description: "Search for tasks in a workspace",
    inputSchema: {
      workspace: {
        type: "string",
        required: true,
        description: "Workspace GID",
      },
      text: {
        type: "string",
        required: false,
        description: "Text to search in name/notes",
      },
      completed: {
        type: "boolean",
        required: false,
        description: "Filter by completed status",
      },
    },
    async execute(input, ctx) {
      const { workspace, text, completed } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (text) qs.text = text;
      if (completed !== undefined) qs.completed = completed;
      return apiRequest(
        ctx,
        "GET",
        `workspaces/${pathSegment(workspace)}/tasks/search`,
        undefined,
        qs,
      );
    },
  });

  // ── Subtask ─────────────────────────────────────────

  rl.registerAction("subtask.create", {
    access: "write",
    description: "Create a subtask on a task",
    inputSchema: {
      taskId: {
        type: "string",
        required: true,
        description: "Parent task GID",
      },
      name: { type: "string", required: true, description: "Subtask name" },
      assignee: {
        type: "string",
        required: false,
        description: "Assignee GID",
      },
      notes: { type: "string", required: false, description: "Subtask notes" },
      dueOn: {
        type: "string",
        required: false,
        description: "Due date (YYYY-MM-DD)",
      },
      completed: {
        type: "boolean",
        required: false,
        description: "Mark as completed",
      },
    },
    async execute(input, ctx) {
      const { taskId, dueOn, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...fields };
      if (dueOn) body.due_on = dueOn;
      return apiRequest(
        ctx,
        "POST",
        `tasks/${pathSegment(taskId)}/subtasks`,
        body,
      );
    },
  });

  rl.registerAction("subtask.list", {
    access: "read",
    description: "List subtasks of a task",
    inputSchema: {
      taskId: {
        type: "string",
        required: true,
        description: "Parent task GID",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { taskId, limit } = input as { taskId: string; limit?: number };
      const data = (await apiRequest(
        ctx,
        "GET",
        `tasks/${pathSegment(taskId)}/subtasks`,
      )) as unknown[];
      if (limit) return (data as unknown[]).slice(0, limit);
      return data;
    },
  });

  // ── Task Comment ────────────────────────────────────

  rl.registerAction("taskComment.add", {
    access: "write",
    description: "Add a comment to a task",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task GID" },
      text: { type: "string", required: true, description: "Comment text" },
      isHtml: {
        type: "boolean",
        required: false,
        description: "Whether text is HTML",
      },
      isPinned: {
        type: "boolean",
        required: false,
        description: "Pin the comment",
      },
    },
    async execute(input, ctx) {
      const { taskId, text, isHtml, isPinned } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = isHtml
        ? { html_text: text }
        : { text };
      if (isPinned) body.is_pinned = true;
      return apiRequest(
        ctx,
        "POST",
        `tasks/${pathSegment(taskId)}/stories`,
        body,
      );
    },
  });

  rl.registerAction("taskComment.remove", {
    access: "write",
    description: "Remove a comment (story) from a task",
    inputSchema: {
      commentId: {
        type: "string",
        required: true,
        description: "Comment/story GID",
      },
    },
    async execute(input, ctx) {
      const { commentId } = input as { commentId: string };
      await apiRequest(ctx, "DELETE", `stories/${pathSegment(commentId)}`);
      return { success: true };
    },
  });

  // ── Task Tag ────────────────────────────────────────

  rl.registerAction("taskTag.add", {
    access: "write",
    description: "Add a tag to a task",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task GID" },
      tagId: { type: "string", required: true, description: "Tag GID" },
    },
    async execute(input, ctx) {
      const { taskId, tagId } = input as { taskId: string; tagId: string };
      await apiRequest(ctx, "POST", `tasks/${pathSegment(taskId)}/addTag`, {
        tag: tagId,
      });
      return { success: true };
    },
  });

  rl.registerAction("taskTag.remove", {
    access: "write",
    description: "Remove a tag from a task",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task GID" },
      tagId: { type: "string", required: true, description: "Tag GID" },
    },
    async execute(input, ctx) {
      const { taskId, tagId } = input as { taskId: string; tagId: string };
      await apiRequest(ctx, "POST", `tasks/${pathSegment(taskId)}/removeTag`, {
        tag: tagId,
      });
      return { success: true };
    },
  });

  // ── Task Project ────────────────────────────────────

  rl.registerAction("taskProject.add", {
    access: "write",
    description: "Add a task to a project",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task GID" },
      projectId: { type: "string", required: true, description: "Project GID" },
      section: {
        type: "string",
        required: false,
        description: "Section GID to insert into",
      },
    },
    async execute(input, ctx) {
      const { taskId, projectId, section } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { project: projectId };
      if (section) body.section = section;
      await apiRequest(
        ctx,
        "POST",
        `tasks/${pathSegment(taskId)}/addProject`,
        body,
      );
      return { success: true };
    },
  });

  rl.registerAction("taskProject.remove", {
    access: "write",
    description: "Remove a task from a project",
    inputSchema: {
      taskId: { type: "string", required: true, description: "Task GID" },
      projectId: { type: "string", required: true, description: "Project GID" },
    },
    async execute(input, ctx) {
      const { taskId, projectId } = input as {
        taskId: string;
        projectId: string;
      };
      await apiRequest(
        ctx,
        "POST",
        `tasks/${pathSegment(taskId)}/removeProject`,
        {
          project: projectId,
        },
      );
      return { success: true };
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.get", {
    access: "read",
    description: "Get a user by ID (or 'me' for current user)",
    inputSchema: {
      userId: {
        type: "string",
        required: true,
        description: "User GID or 'me'",
      },
    },
    async execute(input, ctx) {
      const { userId } = input as { userId: string };
      return apiRequest(ctx, "GET", `users/${pathSegment(userId)}`);
    },
  });

  rl.registerAction("user.list", {
    access: "read",
    description: "List users in a workspace",
    inputSchema: {
      workspace: {
        type: "string",
        required: true,
        description: "Workspace GID",
      },
    },
    async execute(input, ctx) {
      const { workspace } = input as { workspace: string };
      return apiRequest(
        ctx,
        "GET",
        `workspaces/${pathSegment(workspace)}/users`,
      );
    },
  });

  // ── Project ─────────────────────────────────────────

  rl.registerAction("project.create", {
    access: "write",
    description: "Create a new project",
    inputSchema: {
      name: { type: "string", required: true, description: "Project name" },
      workspace: {
        type: "string",
        required: true,
        description: "Workspace GID",
      },
      team: { type: "string", required: true, description: "Team GID" },
      notes: {
        type: "string",
        required: false,
        description: "Project description",
      },
      color: { type: "string", required: false, description: "Project color" },
      dueOn: {
        type: "string",
        required: false,
        description: "Due date (YYYY-MM-DD)",
      },
    },
    async execute(input, ctx) {
      const { name, workspace, team, notes, color, dueOn } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { name, workspace };
      if (notes) body.notes = notes;
      if (color) body.color = color;
      if (dueOn) body.due_on = dueOn;
      return apiRequest(
        ctx,
        "POST",
        `teams/${pathSegment(team)}/projects`,
        body,
      );
    },
  });

  rl.registerAction("project.get", {
    access: "read",
    description: "Get a project by ID",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project GID" },
    },
    async execute(input, ctx) {
      const { projectId } = input as { projectId: string };
      return apiRequest(ctx, "GET", `projects/${pathSegment(projectId)}`);
    },
  });

  rl.registerAction("project.list", {
    access: "read",
    description: "List projects in a workspace",
    inputSchema: {
      workspace: {
        type: "string",
        required: true,
        description: "Workspace GID",
      },
      team: {
        type: "string",
        required: false,
        description: "Filter by team GID",
      },
      archived: {
        type: "boolean",
        required: false,
        description: "Filter by archived status",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { workspace, team, archived, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (team) {
        qs.team = team;
      } else {
        qs.workspace = workspace;
      }
      if (archived !== undefined) qs.archived = archived;
      return paginateAll(ctx, "projects", qs, limit as number | undefined);
    },
  });

  rl.registerAction("project.update", {
    access: "write",
    description: "Update a project",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project GID" },
      name: { type: "string", required: false, description: "Project name" },
      notes: {
        type: "string",
        required: false,
        description: "Project description",
      },
      color: { type: "string", required: false, description: "Project color" },
      owner: { type: "string", required: false, description: "Owner GID" },
      dueOn: {
        type: "string",
        required: false,
        description: "Due date (YYYY-MM-DD)",
      },
    },
    async execute(input, ctx) {
      const { projectId, dueOn, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...fields };
      if (dueOn) body.due_on = dueOn;
      return apiRequest(ctx, "PUT", `projects/${pathSegment(projectId)}`, body);
    },
  });

  rl.registerAction("project.delete", {
    access: "write",
    description: "Delete a project",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project GID" },
    },
    async execute(input, ctx) {
      const { projectId } = input as { projectId: string };
      await apiRequest(ctx, "DELETE", `projects/${pathSegment(projectId)}`);
      return { success: true };
    },
  });
}
