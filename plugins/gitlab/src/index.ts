import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  server: string,
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${server}/api/v4${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`GitLab API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    server: ((ctx.connection.config.server as string) ?? "https://gitlab.com").replace(/\/$/, ""),
    token: ctx.connection.config.token as string,
  };
}

function gl(ctx: { connection: { config: Record<string, unknown> } }, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>) {
  const { server, token } = getConn(ctx);
  return apiRequest(server, token, method, endpoint, body, qs);
}

function projectPath(owner: string, repo: string): string {
  return `/projects/${encodeURIComponent(`${owner}/${repo}`)}`;
}

export default function gitlab(rl: RunlinePluginAPI) {
  rl.setName("gitlab");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    server: { type: "string", required: false, description: "GitLab server URL (default: https://gitlab.com)", env: "GITLAB_SERVER", default: "https://gitlab.com" },
    token: { type: "string", required: true, description: "GitLab personal access token", env: "GITLAB_TOKEN" },
  });

  // ── Issue ───────────────────────────────────────────

  rl.registerAction("issue.create", {
    description: "Create an issue",
    inputSchema: {
      owner: { type: "string", required: true, description: "Group/user namespace" },
      repo: { type: "string", required: true, description: "Project name" },
      title: { type: "string", required: true, description: "Issue title" },
      description: { type: "string", required: false, description: "Issue description (markdown)" },
      labels: { type: "string", required: false, description: "Comma-separated labels" },
      assigneeIds: { type: "array", required: false, description: "Array of assignee user IDs" },
      dueDate: { type: "string", required: false, description: "Due date (YYYY-MM-DD)" },
    },
    async execute(input, ctx) {
      const { owner, repo, title, description: desc, labels, assigneeIds, dueDate } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { title };
      if (desc) body.description = desc;
      if (labels) body.labels = labels;
      if (assigneeIds) body.assignee_ids = assigneeIds;
      if (dueDate) body.due_date = dueDate;
      return gl(ctx, "POST", `${projectPath(owner as string, repo as string)}/issues`, body);
    },
  });

  rl.registerAction("issue.get", {
    description: "Get an issue",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      issueIid: { type: "number", required: true, description: "Issue IID" },
    },
    async execute(input, ctx) {
      const { owner, repo, issueIid } = input as Record<string, unknown>;
      return gl(ctx, "GET", `${projectPath(owner as string, repo as string)}/issues/${issueIid}`);
    },
  });

  rl.registerAction("issue.update", {
    description: "Update an issue",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      issueIid: { type: "number", required: true, description: "Issue IID" },
      title: { type: "string", required: false, description: "New title" },
      description: { type: "string", required: false, description: "New description" },
      labels: { type: "string", required: false, description: "Comma-separated labels" },
      assigneeIds: { type: "array", required: false, description: "Assignee IDs" },
      stateEvent: { type: "string", required: false, description: "close or reopen" },
      dueDate: { type: "string", required: false, description: "Due date" },
    },
    async execute(input, ctx) {
      const { owner, repo, issueIid, title, description: desc, labels, assigneeIds, stateEvent, dueDate } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (title) body.title = title;
      if (desc !== undefined) body.description = desc;
      if (labels !== undefined) body.labels = labels;
      if (assigneeIds) body.assignee_ids = assigneeIds;
      if (stateEvent) body.state_event = stateEvent;
      if (dueDate) body.due_date = dueDate;
      return gl(ctx, "PUT", `${projectPath(owner as string, repo as string)}/issues/${issueIid}`, body);
    },
  });

  rl.registerAction("issue.createNote", {
    description: "Create a comment (note) on an issue",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      issueIid: { type: "number", required: true, description: "Issue IID" },
      body: { type: "string", required: true, description: "Comment body (markdown)" },
    },
    async execute(input, ctx) {
      const { owner, repo, issueIid, body: noteBody } = input as Record<string, unknown>;
      return gl(ctx, "POST", `${projectPath(owner as string, repo as string)}/issues/${issueIid}/notes`, { body: noteBody });
    },
  });

  rl.registerAction("issue.lock", {
    description: "Lock an issue's discussion",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      issueIid: { type: "number", required: true, description: "Issue IID" },
    },
    async execute(input, ctx) {
      const { owner, repo, issueIid } = input as Record<string, unknown>;
      return gl(ctx, "PUT", `${projectPath(owner as string, repo as string)}/issues/${issueIid}`, { discussion_locked: true });
    },
  });

  // ── Release ─────────────────────────────────────────

  rl.registerAction("release.create", {
    description: "Create a release",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project ID or path" },
      tagName: { type: "string", required: true, description: "Tag name" },
      name: { type: "string", required: false, description: "Release name" },
      description: { type: "string", required: false, description: "Release notes (markdown)" },
      ref: { type: "string", required: false, description: "Commit SHA or branch for new tag" },
      milestones: { type: "array", required: false, description: "Milestone titles" },
    },
    async execute(input, ctx) {
      const { projectId, tagName, name, description: desc, ref, milestones } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { tag_name: tagName };
      if (name) body.name = name;
      if (desc) body.description = desc;
      if (ref) body.ref = ref;
      if (milestones) body.milestones = milestones;
      return gl(ctx, "POST", `/projects/${encodeURIComponent(projectId as string)}/releases`, body);
    },
  });

  rl.registerAction("release.get", {
    description: "Get a release by tag",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project ID or path" },
      tagName: { type: "string", required: true, description: "Tag name" },
    },
    async execute(input, ctx) {
      const { projectId, tagName } = input as Record<string, unknown>;
      return gl(ctx, "GET", `/projects/${encodeURIComponent(projectId as string)}/releases/${encodeURIComponent(tagName as string)}`);
    },
  });

  rl.registerAction("release.list", {
    description: "List releases",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project ID or path" },
      limit: { type: "number", required: false, description: "Max results" },
      orderBy: { type: "string", required: false, description: "released_at or created_at" },
      sort: { type: "string", required: false, description: "asc or desc" },
    },
    async execute(input, ctx) {
      const { projectId, limit, orderBy, sort } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.per_page = limit;
      if (orderBy) qs.order_by = orderBy;
      if (sort) qs.sort = sort;
      return gl(ctx, "GET", `/projects/${encodeURIComponent(projectId as string)}/releases`, undefined, qs);
    },
  });

  rl.registerAction("release.update", {
    description: "Update a release",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project ID or path" },
      tagName: { type: "string", required: true, description: "Tag name" },
      name: { type: "string", required: false, description: "New name" },
      description: { type: "string", required: false, description: "New description" },
      milestones: { type: "array", required: false, description: "Milestone titles" },
    },
    async execute(input, ctx) {
      const { projectId, tagName, name, description: desc, milestones } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (desc !== undefined) body.description = desc;
      if (milestones) body.milestones = milestones;
      return gl(ctx, "PUT", `/projects/${encodeURIComponent(projectId as string)}/releases/${encodeURIComponent(tagName as string)}`, body);
    },
  });

  rl.registerAction("release.delete", {
    description: "Delete a release",
    inputSchema: {
      projectId: { type: "string", required: true, description: "Project ID or path" },
      tagName: { type: "string", required: true, description: "Tag name" },
    },
    async execute(input, ctx) {
      const { projectId, tagName } = input as Record<string, unknown>;
      await gl(ctx, "DELETE", `/projects/${encodeURIComponent(projectId as string)}/releases/${encodeURIComponent(tagName as string)}`);
      return { success: true };
    },
  });

  // ── Repository ──────────────────────────────────────

  rl.registerAction("repository.get", {
    description: "Get project details",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
    },
    async execute(input, ctx) {
      const { owner, repo } = input as { owner: string; repo: string };
      return gl(ctx, "GET", projectPath(owner, repo));
    },
  });

  rl.registerAction("repository.listIssues", {
    description: "List issues for a project",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      state: { type: "string", required: false, description: "opened, closed, all" },
      labels: { type: "string", required: false, description: "Comma-separated labels" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { owner, repo, state, labels, limit } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (state) qs.state = state;
      if (labels) qs.labels = labels;
      if (limit) qs.per_page = limit;
      return gl(ctx, "GET", `${projectPath(owner as string, repo as string)}/issues`, undefined, qs);
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.listProjects", {
    description: "List projects for a user",
    inputSchema: {
      username: { type: "string", required: true, description: "Username" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { username, limit } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.per_page = limit;
      return gl(ctx, "GET", `/users/${username}/projects`, undefined, qs);
    },
  });

  // ── File ────────────────────────────────────────────

  rl.registerAction("file.get", {
    description: "Get a file from repository",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      filePath: { type: "string", required: true, description: "File path" },
      ref: { type: "string", required: false, description: "Branch/tag/SHA (default: default branch)" },
    },
    async execute(input, ctx) {
      const { owner, repo, filePath, ref = "main" } = input as Record<string, unknown>;
      return gl(ctx, "GET", `${projectPath(owner as string, repo as string)}/repository/files/${encodeURIComponent(filePath as string)}`, undefined, { ref });
    },
  });

  rl.registerAction("file.createOrUpdate", {
    description: "Create or update a file in repository",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      filePath: { type: "string", required: true, description: "File path" },
      content: { type: "string", required: true, description: "File content" },
      branch: { type: "string", required: true, description: "Target branch" },
      commitMessage: { type: "string", required: true, description: "Commit message" },
      startBranch: { type: "string", required: false, description: "Base branch for new branch" },
      encoding: { type: "string", required: false, description: "text (default) or base64" },
      authorName: { type: "string", required: false, description: "Commit author name" },
      authorEmail: { type: "string", required: false, description: "Commit author email" },
      isUpdate: { type: "boolean", required: false, description: "true=PUT (update), false=POST (create, default)" },
    },
    async execute(input, ctx) {
      const { owner, repo, filePath, content, branch, commitMessage, startBranch, encoding, authorName, authorEmail, isUpdate } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = { branch, commit_message: commitMessage, content };
      if (startBranch) body.start_branch = startBranch;
      if (encoding) body.encoding = encoding;
      if (authorName) body.author_name = authorName;
      if (authorEmail) body.author_email = authorEmail;
      const method = isUpdate ? "PUT" : "POST";
      return gl(ctx, method, `${projectPath(owner as string, repo as string)}/repository/files/${encodeURIComponent(filePath as string)}`, body);
    },
  });

  rl.registerAction("file.delete", {
    description: "Delete a file from repository",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      filePath: { type: "string", required: true, description: "File path" },
      branch: { type: "string", required: true, description: "Branch" },
      commitMessage: { type: "string", required: true, description: "Commit message" },
    },
    async execute(input, ctx) {
      const { owner, repo, filePath, branch, commitMessage } = input as Record<string, unknown>;
      return gl(ctx, "DELETE", `${projectPath(owner as string, repo as string)}/repository/files/${encodeURIComponent(filePath as string)}`, {
        branch, commit_message: commitMessage,
      });
    },
  });

  rl.registerAction("file.list", {
    description: "List repository tree (directory contents)",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      path: { type: "string", required: false, description: "Directory path" },
      ref: { type: "string", required: false, description: "Branch/tag/SHA" },
      recursive: { type: "boolean", required: false, description: "List recursively" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { owner, repo, path, ref, recursive, limit } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (path) qs.path = path;
      if (ref) qs.ref = ref;
      if (recursive) qs.recursive = true;
      if (limit) qs.per_page = limit;
      return gl(ctx, "GET", `${projectPath(owner as string, repo as string)}/repository/tree`, undefined, qs);
    },
  });
}
