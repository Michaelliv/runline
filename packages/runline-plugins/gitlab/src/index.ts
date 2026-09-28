import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialJson,
  pathSegment,
  slashEncodedSegment,
} from "../../_shared/credentials.js";
import { gitlabCredential } from "./credentials.js";

/** A GitLab API call; a DELETE carries a body where GitLab needs one (file deletes). */
function gl(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, gitlabCredential, "gitlab", {
    target: "api",
    path,
    method,
    query,
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
}

/** A project by its namespace and name, as one encoded segment. */
function projectPath(owner: unknown, repo: unknown): string {
  return `projects/${slashEncodedSegment(`${owner}/${repo}`)}`;
}

export default function gitlab(rl: RunlinePluginAPI) {
  rl.setName("gitlab");
  rl.setVersion("0.1.0");
  rl.setCredential(gitlabCredential);

  rl.setConnectionSchema({
    server: {
      type: "string",
      required: false,
      description: "GitLab server URL (default: https://gitlab.com)",
      env: "GITLAB_SERVER",
      default: "https://gitlab.com",
    },
    token: {
      type: "string",
      required: true,
      description: "GitLab personal access token",
      env: "GITLAB_TOKEN",
    },
  });

  // ── Issue ───────────────────────────────────────────

  rl.registerAction("issue.create", {
    access: "write",
    description: "Create an issue",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Group/user namespace",
      },
      repo: { type: "string", required: true, description: "Project name" },
      title: { type: "string", required: true, description: "Issue title" },
      description: {
        type: "string",
        required: false,
        description: "Issue description (markdown)",
      },
      labels: {
        type: "string",
        required: false,
        description: "Comma-separated labels",
      },
      assigneeIds: {
        type: "array",
        required: false,
        description: "Array of assignee user IDs",
      },
      dueDate: {
        type: "string",
        required: false,
        description: "Due date (YYYY-MM-DD)",
      },
    },
    async execute(input, ctx) {
      const {
        owner,
        repo,
        title,
        description: desc,
        labels,
        assigneeIds,
        dueDate,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { title };
      if (desc) body.description = desc;
      if (labels) body.labels = labels;
      if (assigneeIds) body.assignee_ids = assigneeIds;
      if (dueDate) body.due_date = dueDate;
      return gl(ctx, "POST", `${projectPath(owner, repo)}/issues`, body);
    },
  });

  rl.registerAction("issue.get", {
    access: "read",
    description: "Get an issue",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      issueIid: { type: "number", required: true, description: "Issue IID" },
    },
    async execute(input, ctx) {
      const { owner, repo, issueIid } = input as Record<string, unknown>;
      return gl(
        ctx,
        "GET",
        `${projectPath(owner, repo)}/issues/${pathSegment(issueIid)}`,
      );
    },
  });

  rl.registerAction("issue.update", {
    access: "write",
    description: "Update an issue",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      issueIid: { type: "number", required: true, description: "Issue IID" },
      title: { type: "string", required: false, description: "New title" },
      description: {
        type: "string",
        required: false,
        description: "New description",
      },
      labels: {
        type: "string",
        required: false,
        description: "Comma-separated labels",
      },
      assigneeIds: {
        type: "array",
        required: false,
        description: "Assignee IDs",
      },
      stateEvent: {
        type: "string",
        required: false,
        description: "close or reopen",
      },
      dueDate: { type: "string", required: false, description: "Due date" },
    },
    async execute(input, ctx) {
      const {
        owner,
        repo,
        issueIid,
        title,
        description: desc,
        labels,
        assigneeIds,
        stateEvent,
        dueDate,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (title) body.title = title;
      if (desc !== undefined) body.description = desc;
      if (labels !== undefined) body.labels = labels;
      if (assigneeIds) body.assignee_ids = assigneeIds;
      if (stateEvent) body.state_event = stateEvent;
      if (dueDate) body.due_date = dueDate;
      return gl(
        ctx,
        "PUT",
        `${projectPath(owner, repo)}/issues/${pathSegment(issueIid)}`,
        body,
      );
    },
  });

  rl.registerAction("issue.createNote", {
    access: "write",
    description: "Create a comment (note) on an issue",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      issueIid: { type: "number", required: true, description: "Issue IID" },
      body: {
        type: "string",
        required: true,
        description: "Comment body (markdown)",
      },
    },
    async execute(input, ctx) {
      const {
        owner,
        repo,
        issueIid,
        body: noteBody,
      } = input as Record<string, unknown>;
      return gl(
        ctx,
        "POST",
        `${projectPath(owner, repo)}/issues/${pathSegment(issueIid)}/notes`,
        { body: noteBody },
      );
    },
  });

  rl.registerAction("issue.lock", {
    access: "write",
    description: "Lock an issue's discussion",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      issueIid: { type: "number", required: true, description: "Issue IID" },
    },
    async execute(input, ctx) {
      const { owner, repo, issueIid } = input as Record<string, unknown>;
      return gl(
        ctx,
        "PUT",
        `${projectPath(owner, repo)}/issues/${pathSegment(issueIid)}`,
        { discussion_locked: true },
      );
    },
  });

  // ── Release ─────────────────────────────────────────

  rl.registerAction("release.create", {
    access: "write",
    description: "Create a release",
    inputSchema: {
      projectId: {
        type: "string",
        required: true,
        description: "Project ID or path",
      },
      tagName: { type: "string", required: true, description: "Tag name" },
      name: { type: "string", required: false, description: "Release name" },
      description: {
        type: "string",
        required: false,
        description: "Release notes (markdown)",
      },
      ref: {
        type: "string",
        required: false,
        description: "Commit SHA or branch for new tag",
      },
      milestones: {
        type: "array",
        required: false,
        description: "Milestone titles",
      },
    },
    async execute(input, ctx) {
      const {
        projectId,
        tagName,
        name,
        description: desc,
        ref,
        milestones,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { tag_name: tagName };
      if (name) body.name = name;
      if (desc) body.description = desc;
      if (ref) body.ref = ref;
      if (milestones) body.milestones = milestones;
      return gl(
        ctx,
        "POST",
        `projects/${slashEncodedSegment(projectId)}/releases`,
        body,
      );
    },
  });

  rl.registerAction("release.get", {
    access: "read",
    description: "Get a release by tag",
    inputSchema: {
      projectId: {
        type: "string",
        required: true,
        description: "Project ID or path",
      },
      tagName: { type: "string", required: true, description: "Tag name" },
    },
    async execute(input, ctx) {
      const { projectId, tagName } = input as Record<string, unknown>;
      return gl(
        ctx,
        "GET",
        `projects/${slashEncodedSegment(projectId)}/releases/${slashEncodedSegment(tagName)}`,
      );
    },
  });

  rl.registerAction("release.list", {
    access: "read",
    description: "List releases",
    inputSchema: {
      projectId: {
        type: "string",
        required: true,
        description: "Project ID or path",
      },
      limit: { type: "number", required: false, description: "Max results" },
      orderBy: {
        type: "string",
        required: false,
        description: "released_at or created_at",
      },
      sort: { type: "string", required: false, description: "asc or desc" },
    },
    async execute(input, ctx) {
      const { projectId, limit, orderBy, sort } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (limit) qs.per_page = limit;
      if (orderBy) qs.order_by = orderBy;
      if (sort) qs.sort = sort;
      return gl(
        ctx,
        "GET",
        `projects/${slashEncodedSegment(projectId)}/releases`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("release.update", {
    access: "write",
    description: "Update a release",
    inputSchema: {
      projectId: {
        type: "string",
        required: true,
        description: "Project ID or path",
      },
      tagName: { type: "string", required: true, description: "Tag name" },
      name: { type: "string", required: false, description: "New name" },
      description: {
        type: "string",
        required: false,
        description: "New description",
      },
      milestones: {
        type: "array",
        required: false,
        description: "Milestone titles",
      },
    },
    async execute(input, ctx) {
      const {
        projectId,
        tagName,
        name,
        description: desc,
        milestones,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (desc !== undefined) body.description = desc;
      if (milestones) body.milestones = milestones;
      return gl(
        ctx,
        "PUT",
        `projects/${slashEncodedSegment(projectId)}/releases/${slashEncodedSegment(tagName)}`,
        body,
      );
    },
  });

  rl.registerAction("release.delete", {
    access: "write",
    description: "Delete a release",
    inputSchema: {
      projectId: {
        type: "string",
        required: true,
        description: "Project ID or path",
      },
      tagName: { type: "string", required: true, description: "Tag name" },
    },
    async execute(input, ctx) {
      const { projectId, tagName } = input as Record<string, unknown>;
      await gl(
        ctx,
        "DELETE",
        `projects/${slashEncodedSegment(projectId)}/releases/${slashEncodedSegment(tagName)}`,
      );
      return { success: true };
    },
  });

  // ── Repository ──────────────────────────────────────

  rl.registerAction("repository.get", {
    access: "read",
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
    access: "read",
    description: "List issues for a project",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      state: {
        type: "string",
        required: false,
        description: "opened, closed, all",
      },
      labels: {
        type: "string",
        required: false,
        description: "Comma-separated labels",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { owner, repo, state, labels, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (state) qs.state = state;
      if (labels) qs.labels = labels;
      if (limit) qs.per_page = limit;
      return gl(
        ctx,
        "GET",
        `${projectPath(owner, repo)}/issues`,
        undefined,
        qs,
      );
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.listProjects", {
    access: "read",
    description: "List projects for a user",
    inputSchema: {
      username: { type: "string", required: true, description: "Username" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { username, limit } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.per_page = limit;
      return gl(
        ctx,
        "GET",
        `users/${pathSegment(username)}/projects`,
        undefined,
        qs,
      );
    },
  });

  // ── File ────────────────────────────────────────────

  rl.registerAction("file.get", {
    access: "read",
    description: "Get a file from repository",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      filePath: { type: "string", required: true, description: "File path" },
      ref: {
        type: "string",
        required: false,
        description: "Branch/tag/SHA (default: default branch)",
      },
    },
    async execute(input, ctx) {
      const {
        owner,
        repo,
        filePath,
        ref = "main",
      } = input as Record<string, unknown>;
      return gl(
        ctx,
        "GET",
        `${projectPath(owner, repo)}/repository/files/${slashEncodedSegment(filePath)}`,
        undefined,
        { ref },
      );
    },
  });

  rl.registerAction("file.createOrUpdate", {
    access: "write",
    description: "Create or update a file in repository",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      filePath: { type: "string", required: true, description: "File path" },
      content: { type: "string", required: true, description: "File content" },
      branch: { type: "string", required: true, description: "Target branch" },
      commitMessage: {
        type: "string",
        required: true,
        description: "Commit message",
      },
      startBranch: {
        type: "string",
        required: false,
        description: "Base branch for new branch",
      },
      encoding: {
        type: "string",
        required: false,
        description: "text (default) or base64",
      },
      authorName: {
        type: "string",
        required: false,
        description: "Commit author name",
      },
      authorEmail: {
        type: "string",
        required: false,
        description: "Commit author email",
      },
      isUpdate: {
        type: "boolean",
        required: false,
        description: "true=PUT (update), false=POST (create, default)",
      },
    },
    async execute(input, ctx) {
      const {
        owner,
        repo,
        filePath,
        content,
        branch,
        commitMessage,
        startBranch,
        encoding,
        authorName,
        authorEmail,
        isUpdate,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        branch,
        commit_message: commitMessage,
        content,
      };
      if (startBranch) body.start_branch = startBranch;
      if (encoding) body.encoding = encoding;
      if (authorName) body.author_name = authorName;
      if (authorEmail) body.author_email = authorEmail;
      const method = isUpdate ? "PUT" : "POST";
      return gl(
        ctx,
        method,
        `${projectPath(owner, repo)}/repository/files/${slashEncodedSegment(filePath)}`,
        body,
      );
    },
  });

  rl.registerAction("file.delete", {
    access: "write",
    description: "Delete a file from repository",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      filePath: { type: "string", required: true, description: "File path" },
      branch: { type: "string", required: true, description: "Branch" },
      commitMessage: {
        type: "string",
        required: true,
        description: "Commit message",
      },
    },
    async execute(input, ctx) {
      const { owner, repo, filePath, branch, commitMessage } = input as Record<
        string,
        unknown
      >;
      return gl(
        ctx,
        "DELETE",
        `${projectPath(owner, repo)}/repository/files/${slashEncodedSegment(filePath)}`,
        {
          branch,
          commit_message: commitMessage,
        },
      );
    },
  });

  rl.registerAction("file.list", {
    access: "read",
    description: "List repository tree (directory contents)",
    inputSchema: {
      owner: { type: "string", required: true, description: "Namespace" },
      repo: { type: "string", required: true, description: "Project" },
      path: { type: "string", required: false, description: "Directory path" },
      ref: { type: "string", required: false, description: "Branch/tag/SHA" },
      recursive: {
        type: "boolean",
        required: false,
        description: "List recursively",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { owner, repo, path, ref, recursive, limit } = (input ??
        {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (path) qs.path = path;
      if (ref) qs.ref = ref;
      if (recursive) qs.recursive = true;
      if (limit) qs.per_page = limit;
      return gl(
        ctx,
        "GET",
        `${projectPath(owner, repo)}/repository/tree`,
        undefined,
        qs,
      );
    },
  });
}
