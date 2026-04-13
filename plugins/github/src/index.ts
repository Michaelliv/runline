import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  token: string,
  baseUrl: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${baseUrl}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return { success: true };
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const cfg = ctx.connection.config;
  return {
    token: cfg.token as string,
    baseUrl: ((cfg.baseUrl as string) ?? "https://api.github.com").replace(/\/$/, ""),
  };
}

function gh(ctx: { connection: { config: Record<string, unknown> } }, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>) {
  const { token, baseUrl } = getConn(ctx);
  return apiRequest(token, baseUrl, method, endpoint, body, qs);
}

export default function github(rl: RunlinePluginAPI) {
  rl.setName("github");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    token: { type: "string", required: true, description: "GitHub personal access token", env: "GITHUB_TOKEN" },
    baseUrl: { type: "string", required: false, description: "API base URL (default: https://api.github.com)", env: "GITHUB_API_URL", default: "https://api.github.com" },
  });

  // ── File ────────────────────────────────────────────

  rl.registerAction("file.get", {
    description: "Get a file's content from a repository",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      path: { type: "string", required: true, description: "File path" },
      ref: { type: "string", required: false, description: "Branch, tag, or commit SHA" },
    },
    async execute(input, ctx) {
      const { owner, repo, path, ref } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (ref) qs.ref = ref;
      return gh(ctx, "GET", `/repos/${owner}/${repo}/contents/${path}`, undefined, qs);
    },
  });

  rl.registerAction("file.createOrUpdate", {
    description: "Create or update a file in a repository",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      path: { type: "string", required: true, description: "File path" },
      content: { type: "string", required: true, description: "File content (will be base64 encoded)" },
      message: { type: "string", required: true, description: "Commit message" },
      sha: { type: "string", required: false, description: "SHA of file being replaced (required for updates)" },
      branch: { type: "string", required: false, description: "Branch name" },
    },
    async execute(input, ctx) {
      const { owner, repo, path, content, message, sha, branch } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { message, content: btoa(content as string) };
      if (sha) body.sha = sha;
      if (branch) body.branch = branch;
      return gh(ctx, "PUT", `/repos/${owner}/${repo}/contents/${path}`, body);
    },
  });

  rl.registerAction("file.delete", {
    description: "Delete a file from a repository",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      path: { type: "string", required: true, description: "File path" },
      sha: { type: "string", required: true, description: "SHA of file to delete" },
      message: { type: "string", required: true, description: "Commit message" },
      branch: { type: "string", required: false, description: "Branch name" },
    },
    async execute(input, ctx) {
      const { owner, repo, path, sha, message, branch } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { sha, message };
      if (branch) body.branch = branch;
      return gh(ctx, "DELETE", `/repos/${owner}/${repo}/contents/${path}`, body);
    },
  });

  rl.registerAction("file.list", {
    description: "List contents of a directory",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      path: { type: "string", required: false, description: "Directory path (default: root)" },
      ref: { type: "string", required: false, description: "Branch, tag, or SHA" },
    },
    async execute(input, ctx) {
      const { owner, repo, path = "", ref } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (ref) qs.ref = ref;
      return gh(ctx, "GET", `/repos/${owner}/${repo}/contents/${path}`, undefined, qs);
    },
  });

  // ── Issue ───────────────────────────────────────────

  rl.registerAction("issue.create", {
    description: "Create an issue",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      title: { type: "string", required: true, description: "Issue title" },
      body: { type: "string", required: false, description: "Issue body (markdown)" },
      labels: { type: "array", required: false, description: "Label names" },
      assignees: { type: "array", required: false, description: "Assignee usernames" },
      milestone: { type: "number", required: false, description: "Milestone number" },
    },
    async execute(input, ctx) {
      const { owner, repo, title, body: issueBody, labels, assignees, milestone } = input as Record<string, unknown>;
      const b: Record<string, unknown> = { title };
      if (issueBody) b.body = issueBody;
      if (labels) b.labels = labels;
      if (assignees) b.assignees = assignees;
      if (milestone) b.milestone = milestone;
      return gh(ctx, "POST", `/repos/${owner}/${repo}/issues`, b);
    },
  });

  rl.registerAction("issue.get", {
    description: "Get an issue",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      issueNumber: { type: "number", required: true, description: "Issue number" },
    },
    async execute(input, ctx) {
      const { owner, repo, issueNumber } = input as Record<string, unknown>;
      return gh(ctx, "GET", `/repos/${owner}/${repo}/issues/${issueNumber}`);
    },
  });

  rl.registerAction("issue.update", {
    description: "Update an issue",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      issueNumber: { type: "number", required: true, description: "Issue number" },
      title: { type: "string", required: false, description: "New title" },
      body: { type: "string", required: false, description: "New body" },
      state: { type: "string", required: false, description: "open or closed" },
      labels: { type: "array", required: false, description: "Labels" },
      assignees: { type: "array", required: false, description: "Assignees" },
    },
    async execute(input, ctx) {
      const { owner, repo, issueNumber, ...fields } = input as Record<string, unknown>;
      return gh(ctx, "PATCH", `/repos/${owner}/${repo}/issues/${issueNumber}`, fields);
    },
  });

  rl.registerAction("issue.createComment", {
    description: "Create a comment on an issue",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      issueNumber: { type: "number", required: true, description: "Issue number" },
      body: { type: "string", required: true, description: "Comment body (markdown)" },
    },
    async execute(input, ctx) {
      const { owner, repo, issueNumber, body: commentBody } = input as Record<string, unknown>;
      return gh(ctx, "POST", `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body: commentBody });
    },
  });

  rl.registerAction("issue.lock", {
    description: "Lock an issue",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      issueNumber: { type: "number", required: true, description: "Issue number" },
      lockReason: { type: "string", required: false, description: "Reason: off-topic, too heated, resolved, spam" },
    },
    async execute(input, ctx) {
      const { owner, repo, issueNumber, lockReason } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (lockReason) body.lock_reason = lockReason;
      await gh(ctx, "PUT", `/repos/${owner}/${repo}/issues/${issueNumber}/lock`, body);
      return { success: true };
    },
  });

  // ── Release ─────────────────────────────────────────

  rl.registerAction("release.create", {
    description: "Create a release",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      tagName: { type: "string", required: true, description: "Tag name" },
      name: { type: "string", required: false, description: "Release name" },
      body: { type: "string", required: false, description: "Release notes (markdown)" },
      draft: { type: "boolean", required: false, description: "Create as draft" },
      prerelease: { type: "boolean", required: false, description: "Mark as pre-release" },
      targetCommitish: { type: "string", required: false, description: "Branch or commit SHA for the tag" },
    },
    async execute(input, ctx) {
      const { owner, repo, tagName, name, body: releaseBody, draft, prerelease, targetCommitish } = input as Record<string, unknown>;
      const b: Record<string, unknown> = { tag_name: tagName };
      if (name) b.name = name;
      if (releaseBody) b.body = releaseBody;
      if (draft !== undefined) b.draft = draft;
      if (prerelease !== undefined) b.prerelease = prerelease;
      if (targetCommitish) b.target_commitish = targetCommitish;
      return gh(ctx, "POST", `/repos/${owner}/${repo}/releases`, b);
    },
  });

  rl.registerAction("release.get", {
    description: "Get a release",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      releaseId: { type: "string", required: true, description: "Release ID" },
    },
    async execute(input, ctx) {
      const { owner, repo, releaseId } = input as Record<string, unknown>;
      return gh(ctx, "GET", `/repos/${owner}/${repo}/releases/${releaseId}`);
    },
  });

  rl.registerAction("release.list", {
    description: "List releases",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      perPage: { type: "number", required: false, description: "Results per page (max: 100)" },
      page: { type: "number", required: false, description: "Page number" },
    },
    async execute(input, ctx) {
      const { owner, repo, perPage, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (perPage) qs.per_page = perPage;
      if (page) qs.page = page;
      return gh(ctx, "GET", `/repos/${owner}/${repo}/releases`, undefined, qs);
    },
  });

  rl.registerAction("release.update", {
    description: "Update a release",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      releaseId: { type: "string", required: true, description: "Release ID" },
      tagName: { type: "string", required: false, description: "New tag name" },
      name: { type: "string", required: false, description: "New name" },
      body: { type: "string", required: false, description: "New release notes" },
      draft: { type: "boolean", required: false, description: "Draft flag" },
      prerelease: { type: "boolean", required: false, description: "Pre-release flag" },
    },
    async execute(input, ctx) {
      const { owner, repo, releaseId, tagName, name, body: releaseBody, draft, prerelease } = input as Record<string, unknown>;
      const b: Record<string, unknown> = {};
      if (tagName) b.tag_name = tagName;
      if (name) b.name = name;
      if (releaseBody !== undefined) b.body = releaseBody;
      if (draft !== undefined) b.draft = draft;
      if (prerelease !== undefined) b.prerelease = prerelease;
      return gh(ctx, "PATCH", `/repos/${owner}/${repo}/releases/${releaseId}`, b);
    },
  });

  rl.registerAction("release.delete", {
    description: "Delete a release",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      releaseId: { type: "string", required: true, description: "Release ID" },
    },
    async execute(input, ctx) {
      const { owner, repo, releaseId } = input as Record<string, unknown>;
      await gh(ctx, "DELETE", `/repos/${owner}/${repo}/releases/${releaseId}`);
      return { success: true };
    },
  });

  // ── Repository ──────────────────────────────────────

  rl.registerAction("repository.get", {
    description: "Get repository details",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
    },
    async execute(input, ctx) {
      const { owner, repo } = input as { owner: string; repo: string };
      return gh(ctx, "GET", `/repos/${owner}/${repo}`);
    },
  });

  rl.registerAction("repository.getLicense", {
    description: "Get a repository's license",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
    },
    async execute(input, ctx) {
      const { owner, repo } = input as { owner: string; repo: string };
      return gh(ctx, "GET", `/repos/${owner}/${repo}/license`);
    },
  });

  rl.registerAction("repository.listIssues", {
    description: "List issues for a repository",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      state: { type: "string", required: false, description: "open, closed, or all" },
      labels: { type: "string", required: false, description: "Comma-separated label names" },
      sort: { type: "string", required: false, description: "created, updated, comments" },
      direction: { type: "string", required: false, description: "asc or desc" },
      perPage: { type: "number", required: false, description: "Results per page" },
      page: { type: "number", required: false, description: "Page number" },
    },
    async execute(input, ctx) {
      const { owner, repo, state, labels, sort, direction, perPage, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (state) qs.state = state;
      if (labels) qs.labels = labels;
      if (sort) qs.sort = sort;
      if (direction) qs.direction = direction;
      if (perPage) qs.per_page = perPage;
      if (page) qs.page = page;
      return gh(ctx, "GET", `/repos/${owner}/${repo}/issues`, undefined, qs);
    },
  });

  rl.registerAction("repository.listPullRequests", {
    description: "List pull requests",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      state: { type: "string", required: false, description: "open, closed, or all" },
      sort: { type: "string", required: false, description: "created, updated, popularity, long-running" },
      direction: { type: "string", required: false, description: "asc or desc" },
      perPage: { type: "number", required: false, description: "Results per page" },
      page: { type: "number", required: false, description: "Page number" },
    },
    async execute(input, ctx) {
      const { owner, repo, state, sort, direction, perPage, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (state) qs.state = state;
      if (sort) qs.sort = sort;
      if (direction) qs.direction = direction;
      if (perPage) qs.per_page = perPage;
      if (page) qs.page = page;
      return gh(ctx, "GET", `/repos/${owner}/${repo}/pulls`, undefined, qs);
    },
  });

  rl.registerAction("repository.listPopularPaths", {
    description: "List popular content paths (traffic)",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
    },
    async execute(input, ctx) {
      const { owner, repo } = input as { owner: string; repo: string };
      return gh(ctx, "GET", `/repos/${owner}/${repo}/traffic/popular/paths`);
    },
  });

  rl.registerAction("repository.listReferrers", {
    description: "List top referral sources (traffic)",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
    },
    async execute(input, ctx) {
      const { owner, repo } = input as { owner: string; repo: string };
      return gh(ctx, "GET", `/repos/${owner}/${repo}/traffic/popular/referrers`);
    },
  });

  // ── Review ──────────────────────────────────────────

  rl.registerAction("review.get", {
    description: "Get a pull request review",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      pullNumber: { type: "number", required: true, description: "Pull request number" },
      reviewId: { type: "number", required: true, description: "Review ID" },
    },
    async execute(input, ctx) {
      const { owner, repo, pullNumber, reviewId } = input as Record<string, unknown>;
      return gh(ctx, "GET", `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews/${reviewId}`);
    },
  });

  rl.registerAction("review.list", {
    description: "List reviews on a pull request",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      pullNumber: { type: "number", required: true, description: "Pull request number" },
    },
    async execute(input, ctx) {
      const { owner, repo, pullNumber } = input as Record<string, unknown>;
      return gh(ctx, "GET", `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`);
    },
  });

  rl.registerAction("review.create", {
    description: "Create a review on a pull request",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      pullNumber: { type: "number", required: true, description: "Pull request number" },
      event: { type: "string", required: true, description: "APPROVE, REQUEST_CHANGES, or COMMENT" },
      body: { type: "string", required: false, description: "Review body" },
    },
    async execute(input, ctx) {
      const { owner, repo, pullNumber, event, body: reviewBody } = input as Record<string, unknown>;
      const b: Record<string, unknown> = { event };
      if (reviewBody) b.body = reviewBody;
      return gh(ctx, "POST", `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, b);
    },
  });

  rl.registerAction("review.update", {
    description: "Update a review",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      pullNumber: { type: "number", required: true, description: "Pull request number" },
      reviewId: { type: "number", required: true, description: "Review ID" },
      body: { type: "string", required: true, description: "Updated review body" },
    },
    async execute(input, ctx) {
      const { owner, repo, pullNumber, reviewId, body: reviewBody } = input as Record<string, unknown>;
      return gh(ctx, "PUT", `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews/${reviewId}`, { body: reviewBody });
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.listRepos", {
    description: "List repositories for a user",
    inputSchema: {
      username: { type: "string", required: false, description: "Username (omit for authenticated user)" },
      type: { type: "string", required: false, description: "all, owner, member" },
      sort: { type: "string", required: false, description: "created, updated, pushed, full_name" },
      perPage: { type: "number", required: false, description: "Results per page" },
      page: { type: "number", required: false, description: "Page number" },
    },
    async execute(input, ctx) {
      const { username, type, sort, perPage, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (type) qs.type = type;
      if (sort) qs.sort = sort;
      if (perPage) qs.per_page = perPage;
      if (page) qs.page = page;
      const endpoint = username ? `/users/${username}/repos` : "/user/repos";
      return gh(ctx, "GET", endpoint, undefined, qs);
    },
  });

  rl.registerAction("user.listIssues", {
    description: "List issues assigned to the authenticated user",
    inputSchema: {
      state: { type: "string", required: false, description: "open, closed, or all" },
      sort: { type: "string", required: false, description: "created, updated, comments" },
      perPage: { type: "number", required: false, description: "Results per page" },
    },
    async execute(input, ctx) {
      const { state, sort, perPage } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (state) qs.state = state;
      if (sort) qs.sort = sort;
      if (perPage) qs.per_page = perPage;
      return gh(ctx, "GET", "/user/issues", undefined, qs);
    },
  });

  rl.registerAction("user.invite", {
    description: "Invite a user to a repository",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      username: { type: "string", required: true, description: "Username to invite" },
      permission: { type: "string", required: false, description: "pull, push, admin, maintain, triage" },
    },
    async execute(input, ctx) {
      const { owner, repo, username, permission } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (permission) body.permission = permission;
      return gh(ctx, "PUT", `/repos/${owner}/${repo}/collaborators/${username}`, body);
    },
  });

  // ── Organization ────────────────────────────────────

  rl.registerAction("organization.listRepos", {
    description: "List repositories for an organization",
    inputSchema: {
      org: { type: "string", required: true, description: "Organization name" },
      type: { type: "string", required: false, description: "all, public, private, forks, sources, member" },
      sort: { type: "string", required: false, description: "created, updated, pushed, full_name" },
      perPage: { type: "number", required: false, description: "Results per page" },
      page: { type: "number", required: false, description: "Page number" },
    },
    async execute(input, ctx) {
      const { org, type, sort, perPage, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (type) qs.type = type;
      if (sort) qs.sort = sort;
      if (perPage) qs.per_page = perPage;
      if (page) qs.page = page;
      return gh(ctx, "GET", `/orgs/${org}/repos`, undefined, qs);
    },
  });

  // ── Workflow ────────────────────────────────────────

  rl.registerAction("workflow.list", {
    description: "List workflows in a repository",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
    },
    async execute(input, ctx) {
      const { owner, repo } = input as { owner: string; repo: string };
      const data = (await gh(ctx, "GET", `/repos/${owner}/${repo}/actions/workflows`)) as Record<string, unknown>;
      return data.workflows;
    },
  });

  rl.registerAction("workflow.get", {
    description: "Get a workflow",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      workflowId: { type: "string", required: true, description: "Workflow ID or filename" },
    },
    async execute(input, ctx) {
      const { owner, repo, workflowId } = input as Record<string, unknown>;
      return gh(ctx, "GET", `/repos/${owner}/${repo}/actions/workflows/${workflowId}`);
    },
  });

  rl.registerAction("workflow.dispatch", {
    description: "Trigger a workflow dispatch event",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      workflowId: { type: "string", required: true, description: "Workflow ID or filename" },
      ref: { type: "string", required: true, description: "Branch or tag to run on" },
      inputs: { type: "object", required: false, description: "Workflow input parameters" },
    },
    async execute(input, ctx) {
      const { owner, repo, workflowId, ref, inputs } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { ref };
      if (inputs) body.inputs = inputs;
      await gh(ctx, "POST", `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, body);
      return { success: true };
    },
  });

  rl.registerAction("workflow.enable", {
    description: "Enable a workflow",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      workflowId: { type: "string", required: true, description: "Workflow ID" },
    },
    async execute(input, ctx) {
      const { owner, repo, workflowId } = input as Record<string, unknown>;
      await gh(ctx, "PUT", `/repos/${owner}/${repo}/actions/workflows/${workflowId}/enable`);
      return { success: true };
    },
  });

  rl.registerAction("workflow.disable", {
    description: "Disable a workflow",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      workflowId: { type: "string", required: true, description: "Workflow ID" },
    },
    async execute(input, ctx) {
      const { owner, repo, workflowId } = input as Record<string, unknown>;
      await gh(ctx, "PUT", `/repos/${owner}/${repo}/actions/workflows/${workflowId}/disable`);
      return { success: true };
    },
  });

  rl.registerAction("workflow.getUsage", {
    description: "Get workflow usage billing",
    inputSchema: {
      owner: { type: "string", required: true, description: "Repository owner" },
      repo: { type: "string", required: true, description: "Repository name" },
      workflowId: { type: "string", required: true, description: "Workflow ID" },
    },
    async execute(input, ctx) {
      const { owner, repo, workflowId } = input as Record<string, unknown>;
      return gh(ctx, "GET", `/repos/${owner}/${repo}/actions/workflows/${workflowId}/timing`);
    },
  });
}
