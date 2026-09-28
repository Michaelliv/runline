import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialJson,
  pathSegment,
  pathSegments,
} from "../../_shared/credentials.js";
import { GITHUB_API_VERSION, githubCredential } from "./credentials.js";

function gh(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, githubCredential, "github", {
    target: "api",
    path,
    method,
    query,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
    // DELETE carries a body where GitHub needs one (a file's sha and message).
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
}

export default function github(rl: RunlinePluginAPI) {
  rl.setName("github");
  rl.setVersion("0.1.0");
  rl.setCredential(githubCredential);

  rl.setConnectionSchema({
    token: {
      type: "string",
      required: true,
      description: "GitHub personal access token",
      env: "GITHUB_TOKEN",
    },
    baseUrl: {
      type: "string",
      required: false,
      description: "API base URL (default: https://api.github.com)",
      env: "GITHUB_API_URL",
      default: "https://api.github.com",
    },
  });

  // ── File ────────────────────────────────────────────

  rl.registerAction("file.get", {
    access: "read",
    description: "Get a file's content from a repository",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      path: { type: "string", required: true, description: "File path" },
      ref: {
        type: "string",
        required: false,
        description: "Branch, tag, or commit SHA",
      },
    },
    async execute(input, ctx) {
      const { owner, repo, path, ref } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (ref) qs.ref = ref;
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/contents/${pathSegments(path)}`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("file.createOrUpdate", {
    access: "write",
    description: "Create or update a file in a repository",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      path: { type: "string", required: true, description: "File path" },
      content: {
        type: "string",
        required: true,
        description: "File content (will be base64 encoded)",
      },
      message: {
        type: "string",
        required: true,
        description: "Commit message",
      },
      sha: {
        type: "string",
        required: false,
        description: "SHA of file being replaced (required for updates)",
      },
      branch: { type: "string", required: false, description: "Branch name" },
    },
    async execute(input, ctx) {
      const { owner, repo, path, content, message, sha, branch } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        message,
        content: btoa(content as string),
      };
      if (sha) body.sha = sha;
      if (branch) body.branch = branch;
      return gh(
        ctx,
        "PUT",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/contents/${pathSegments(path)}`,
        body,
      );
    },
  });

  rl.registerAction("file.delete", {
    access: "write",
    description: "Delete a file from a repository",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      path: { type: "string", required: true, description: "File path" },
      sha: {
        type: "string",
        required: true,
        description: "SHA of file to delete",
      },
      message: {
        type: "string",
        required: true,
        description: "Commit message",
      },
      branch: { type: "string", required: false, description: "Branch name" },
    },
    async execute(input, ctx) {
      const { owner, repo, path, sha, message, branch } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { sha, message };
      if (branch) body.branch = branch;
      return gh(
        ctx,
        "DELETE",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/contents/${pathSegments(path)}`,
        body,
      );
    },
  });

  rl.registerAction("file.list", {
    access: "read",
    description: "List contents of a directory",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      path: {
        type: "string",
        required: false,
        description: "Directory path (default: root)",
      },
      ref: {
        type: "string",
        required: false,
        description: "Branch, tag, or SHA",
      },
    },
    async execute(input, ctx) {
      const { owner, repo, path, ref } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (ref) qs.ref = ref;
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/contents/${path ? pathSegments(path) : ""}`,
        undefined,
        qs,
      );
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
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      title: { type: "string", required: true, description: "Issue title" },
      body: {
        type: "string",
        required: false,
        description: "Issue body (markdown)",
      },
      labels: { type: "array", required: false, description: "Label names" },
      assignees: {
        type: "array",
        required: false,
        description: "Assignee usernames",
      },
      milestone: {
        type: "number",
        required: false,
        description: "Milestone number",
      },
    },
    async execute(input, ctx) {
      const {
        owner,
        repo,
        title,
        body: issueBody,
        labels,
        assignees,
        milestone,
      } = input as Record<string, unknown>;
      const b: Record<string, unknown> = { title };
      if (issueBody) b.body = issueBody;
      if (labels) b.labels = labels;
      if (assignees) b.assignees = assignees;
      if (milestone) b.milestone = milestone;
      return gh(
        ctx,
        "POST",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/issues`,
        b,
      );
    },
  });

  rl.registerAction("issue.get", {
    access: "read",
    description: "Get an issue",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      issueNumber: {
        type: "number",
        required: true,
        description: "Issue number",
      },
    },
    async execute(input, ctx) {
      const { owner, repo, issueNumber } = input as Record<string, unknown>;
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/issues/${pathSegment(issueNumber)}`,
      );
    },
  });

  rl.registerAction("issue.update", {
    access: "write",
    description: "Update an issue",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      issueNumber: {
        type: "number",
        required: true,
        description: "Issue number",
      },
      title: { type: "string", required: false, description: "New title" },
      body: { type: "string", required: false, description: "New body" },
      state: { type: "string", required: false, description: "open or closed" },
      labels: { type: "array", required: false, description: "Labels" },
      assignees: { type: "array", required: false, description: "Assignees" },
    },
    async execute(input, ctx) {
      const { owner, repo, issueNumber, ...fields } = input as Record<
        string,
        unknown
      >;
      return gh(
        ctx,
        "PATCH",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/issues/${pathSegment(issueNumber)}`,
        fields,
      );
    },
  });

  rl.registerAction("issue.createComment", {
    access: "write",
    description: "Create a comment on an issue",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      issueNumber: {
        type: "number",
        required: true,
        description: "Issue number",
      },
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
        issueNumber,
        body: commentBody,
      } = input as Record<string, unknown>;
      return gh(
        ctx,
        "POST",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/issues/${pathSegment(issueNumber)}/comments`,
        { body: commentBody },
      );
    },
  });

  rl.registerAction("issue.lock", {
    access: "write",
    description: "Lock an issue",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      issueNumber: {
        type: "number",
        required: true,
        description: "Issue number",
      },
      lockReason: {
        type: "string",
        required: false,
        description: "Reason: off-topic, too heated, resolved, spam",
      },
    },
    async execute(input, ctx) {
      const { owner, repo, issueNumber, lockReason } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {};
      if (lockReason) body.lock_reason = lockReason;
      await gh(
        ctx,
        "PUT",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/issues/${pathSegment(issueNumber)}/lock`,
        body,
      );
      return { success: true };
    },
  });

  // ── Release ─────────────────────────────────────────

  rl.registerAction("release.create", {
    access: "write",
    description: "Create a release",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      tagName: { type: "string", required: true, description: "Tag name" },
      name: { type: "string", required: false, description: "Release name" },
      body: {
        type: "string",
        required: false,
        description: "Release notes (markdown)",
      },
      draft: {
        type: "boolean",
        required: false,
        description: "Create as draft",
      },
      prerelease: {
        type: "boolean",
        required: false,
        description: "Mark as pre-release",
      },
      targetCommitish: {
        type: "string",
        required: false,
        description: "Branch or commit SHA for the tag",
      },
    },
    async execute(input, ctx) {
      const {
        owner,
        repo,
        tagName,
        name,
        body: releaseBody,
        draft,
        prerelease,
        targetCommitish,
      } = input as Record<string, unknown>;
      const b: Record<string, unknown> = { tag_name: tagName };
      if (name) b.name = name;
      if (releaseBody) b.body = releaseBody;
      if (draft !== undefined) b.draft = draft;
      if (prerelease !== undefined) b.prerelease = prerelease;
      if (targetCommitish) b.target_commitish = targetCommitish;
      return gh(
        ctx,
        "POST",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/releases`,
        b,
      );
    },
  });

  rl.registerAction("release.get", {
    access: "read",
    description: "Get a release",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      releaseId: { type: "string", required: true, description: "Release ID" },
    },
    async execute(input, ctx) {
      const { owner, repo, releaseId } = input as Record<string, unknown>;
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/releases/${pathSegment(releaseId)}`,
      );
    },
  });

  rl.registerAction("release.list", {
    access: "read",
    description: "List releases",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      perPage: {
        type: "number",
        required: false,
        description: "Results per page (max: 100)",
      },
      page: { type: "number", required: false, description: "Page number" },
    },
    async execute(input, ctx) {
      const { owner, repo, perPage, page } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (perPage) qs.per_page = perPage;
      if (page) qs.page = page;
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/releases`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("release.update", {
    access: "write",
    description: "Update a release",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      releaseId: { type: "string", required: true, description: "Release ID" },
      tagName: { type: "string", required: false, description: "New tag name" },
      name: { type: "string", required: false, description: "New name" },
      body: {
        type: "string",
        required: false,
        description: "New release notes",
      },
      draft: { type: "boolean", required: false, description: "Draft flag" },
      prerelease: {
        type: "boolean",
        required: false,
        description: "Pre-release flag",
      },
    },
    async execute(input, ctx) {
      const {
        owner,
        repo,
        releaseId,
        tagName,
        name,
        body: releaseBody,
        draft,
        prerelease,
      } = input as Record<string, unknown>;
      const b: Record<string, unknown> = {};
      if (tagName) b.tag_name = tagName;
      if (name) b.name = name;
      if (releaseBody !== undefined) b.body = releaseBody;
      if (draft !== undefined) b.draft = draft;
      if (prerelease !== undefined) b.prerelease = prerelease;
      return gh(
        ctx,
        "PATCH",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/releases/${pathSegment(releaseId)}`,
        b,
      );
    },
  });

  rl.registerAction("release.delete", {
    access: "write",
    description: "Delete a release",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      releaseId: { type: "string", required: true, description: "Release ID" },
    },
    async execute(input, ctx) {
      const { owner, repo, releaseId } = input as Record<string, unknown>;
      await gh(
        ctx,
        "DELETE",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/releases/${pathSegment(releaseId)}`,
      );
      return { success: true };
    },
  });

  // ── Repository ──────────────────────────────────────

  rl.registerAction("commit.list", {
    access: "read",
    description:
      "List repository commits, including latest commits on a branch or path",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      sha: {
        type: "string",
        required: false,
        description: "SHA or branch to start listing commits from",
      },
      path: {
        type: "string",
        required: false,
        description: "Only commits containing this file path",
      },
      author: {
        type: "string",
        required: false,
        description: "GitHub username or email address",
      },
      since: {
        type: "string",
        required: false,
        description: "Only commits after this ISO 8601 timestamp",
      },
      until: {
        type: "string",
        required: false,
        description: "Only commits before this ISO 8601 timestamp",
      },
      perPage: {
        type: "number",
        required: false,
        description: "Results per page (max: 100)",
      },
      page: { type: "number", required: false, description: "Page number" },
    },
    async execute(input, ctx) {
      const { owner, repo, sha, path, author, since, until, perPage, page } =
        (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (sha) qs.sha = sha;
      if (path) qs.path = path;
      if (author) qs.author = author;
      if (since) qs.since = since;
      if (until) qs.until = until;
      if (perPage) qs.per_page = perPage;
      if (page) qs.page = page;
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/commits`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("commit.get", {
    access: "read",
    description: "Get a repository commit by SHA, branch, or tag ref",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      ref: {
        type: "string",
        required: true,
        description: "Commit SHA, branch name, or tag name",
      },
    },
    async execute(input, ctx) {
      const { owner, repo, ref } = input as Record<string, unknown>;
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/commits/${pathSegments(ref)}`,
      );
    },
  });

  rl.registerAction("branch.get", {
    access: "read",
    description: "Get a repository branch, including its latest commit",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      branch: { type: "string", required: true, description: "Branch name" },
    },
    async execute(input, ctx) {
      const { owner, repo, branch } = input as Record<string, unknown>;
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/branches/${pathSegments(branch)}`,
      );
    },
  });

  rl.registerAction("repository.get", {
    access: "read",
    description: "Get repository details",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
    },
    async execute(input, ctx) {
      const { owner, repo } = input as { owner: string; repo: string };
      return gh(ctx, "GET", `repos/${pathSegment(owner)}/${pathSegment(repo)}`);
    },
  });

  rl.registerAction("repository.getLicense", {
    access: "read",
    description: "Get a repository's license",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
    },
    async execute(input, ctx) {
      const { owner, repo } = input as { owner: string; repo: string };
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/license`,
      );
    },
  });

  rl.registerAction("repository.listIssues", {
    access: "read",
    description: "List issues for a repository",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      state: {
        type: "string",
        required: false,
        description: "open, closed, or all",
      },
      labels: {
        type: "string",
        required: false,
        description: "Comma-separated label names",
      },
      sort: {
        type: "string",
        required: false,
        description: "created, updated, comments",
      },
      direction: {
        type: "string",
        required: false,
        description: "asc or desc",
      },
      perPage: {
        type: "number",
        required: false,
        description: "Results per page",
      },
      page: { type: "number", required: false, description: "Page number" },
    },
    async execute(input, ctx) {
      const { owner, repo, state, labels, sort, direction, perPage, page } =
        (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (state) qs.state = state;
      if (labels) qs.labels = labels;
      if (sort) qs.sort = sort;
      if (direction) qs.direction = direction;
      if (perPage) qs.per_page = perPage;
      if (page) qs.page = page;
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/issues`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("repository.listPullRequests", {
    access: "read",
    description: "List pull requests",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      state: {
        type: "string",
        required: false,
        description: "open, closed, or all",
      },
      sort: {
        type: "string",
        required: false,
        description: "created, updated, popularity, long-running",
      },
      direction: {
        type: "string",
        required: false,
        description: "asc or desc",
      },
      perPage: {
        type: "number",
        required: false,
        description: "Results per page",
      },
      page: { type: "number", required: false, description: "Page number" },
    },
    async execute(input, ctx) {
      const { owner, repo, state, sort, direction, perPage, page } = (input ??
        {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (state) qs.state = state;
      if (sort) qs.sort = sort;
      if (direction) qs.direction = direction;
      if (perPage) qs.per_page = perPage;
      if (page) qs.page = page;
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/pulls`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("repository.listPopularPaths", {
    access: "read",
    description: "List popular content paths (traffic)",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
    },
    async execute(input, ctx) {
      const { owner, repo } = input as { owner: string; repo: string };
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/traffic/popular/paths`,
      );
    },
  });

  rl.registerAction("repository.listReferrers", {
    access: "read",
    description: "List top referral sources (traffic)",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
    },
    async execute(input, ctx) {
      const { owner, repo } = input as { owner: string; repo: string };
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/traffic/popular/referrers`,
      );
    },
  });

  // ── Review ──────────────────────────────────────────

  rl.registerAction("review.get", {
    access: "read",
    description: "Get a pull request review",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      pullNumber: {
        type: "number",
        required: true,
        description: "Pull request number",
      },
      reviewId: { type: "number", required: true, description: "Review ID" },
    },
    async execute(input, ctx) {
      const { owner, repo, pullNumber, reviewId } = input as Record<
        string,
        unknown
      >;
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/pulls/${pathSegment(pullNumber)}/reviews/${pathSegment(reviewId)}`,
      );
    },
  });

  rl.registerAction("review.list", {
    access: "read",
    description: "List reviews on a pull request",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      pullNumber: {
        type: "number",
        required: true,
        description: "Pull request number",
      },
    },
    async execute(input, ctx) {
      const { owner, repo, pullNumber } = input as Record<string, unknown>;
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/pulls/${pathSegment(pullNumber)}/reviews`,
      );
    },
  });

  rl.registerAction("review.create", {
    access: "write",
    description: "Create a review on a pull request",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      pullNumber: {
        type: "number",
        required: true,
        description: "Pull request number",
      },
      event: {
        type: "string",
        required: true,
        description: "APPROVE, REQUEST_CHANGES, or COMMENT",
      },
      body: { type: "string", required: false, description: "Review body" },
    },
    async execute(input, ctx) {
      const {
        owner,
        repo,
        pullNumber,
        event,
        body: reviewBody,
      } = input as Record<string, unknown>;
      const b: Record<string, unknown> = { event };
      if (reviewBody) b.body = reviewBody;
      return gh(
        ctx,
        "POST",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/pulls/${pathSegment(pullNumber)}/reviews`,
        b,
      );
    },
  });

  rl.registerAction("review.update", {
    access: "write",
    description: "Update a review",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      pullNumber: {
        type: "number",
        required: true,
        description: "Pull request number",
      },
      reviewId: { type: "number", required: true, description: "Review ID" },
      body: {
        type: "string",
        required: true,
        description: "Updated review body",
      },
    },
    async execute(input, ctx) {
      const {
        owner,
        repo,
        pullNumber,
        reviewId,
        body: reviewBody,
      } = input as Record<string, unknown>;
      return gh(
        ctx,
        "PUT",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/pulls/${pathSegment(pullNumber)}/reviews/${pathSegment(reviewId)}`,
        { body: reviewBody },
      );
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.listRepos", {
    access: "read",
    description: "List repositories for a user",
    inputSchema: {
      username: {
        type: "string",
        required: false,
        description: "Username (omit for authenticated user)",
      },
      type: {
        type: "string",
        required: false,
        description: "all, owner, member",
      },
      sort: {
        type: "string",
        required: false,
        description: "created, updated, pushed, full_name",
      },
      perPage: {
        type: "number",
        required: false,
        description: "Results per page",
      },
      page: { type: "number", required: false, description: "Page number" },
    },
    async execute(input, ctx) {
      const { username, type, sort, perPage, page } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (type) qs.type = type;
      if (sort) qs.sort = sort;
      if (perPage) qs.per_page = perPage;
      if (page) qs.page = page;
      const endpoint = username
        ? `users/${pathSegment(username)}/repos`
        : "user/repos";
      return gh(ctx, "GET", endpoint, undefined, qs);
    },
  });

  rl.registerAction("user.listIssues", {
    access: "read",
    description: "List issues assigned to the authenticated user",
    inputSchema: {
      state: {
        type: "string",
        required: false,
        description: "open, closed, or all",
      },
      sort: {
        type: "string",
        required: false,
        description: "created, updated, comments",
      },
      perPage: {
        type: "number",
        required: false,
        description: "Results per page",
      },
    },
    async execute(input, ctx) {
      const { state, sort, perPage } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (state) qs.state = state;
      if (sort) qs.sort = sort;
      if (perPage) qs.per_page = perPage;
      return gh(ctx, "GET", "user/issues", undefined, qs);
    },
  });

  rl.registerAction("user.invite", {
    access: "write",
    description: "Invite a user to a repository",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      username: {
        type: "string",
        required: true,
        description: "Username to invite",
      },
      permission: {
        type: "string",
        required: false,
        description: "pull, push, admin, maintain, triage",
      },
    },
    async execute(input, ctx) {
      const { owner, repo, username, permission } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {};
      if (permission) body.permission = permission;
      return gh(
        ctx,
        "PUT",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/collaborators/${pathSegment(username)}`,
        body,
      );
    },
  });

  // ── Organization ────────────────────────────────────

  rl.registerAction("organization.listRepos", {
    access: "read",
    description: "List repositories for an organization",
    inputSchema: {
      org: { type: "string", required: true, description: "Organization name" },
      type: {
        type: "string",
        required: false,
        description: "all, public, private, forks, sources, member",
      },
      sort: {
        type: "string",
        required: false,
        description: "created, updated, pushed, full_name",
      },
      perPage: {
        type: "number",
        required: false,
        description: "Results per page",
      },
      page: { type: "number", required: false, description: "Page number" },
    },
    async execute(input, ctx) {
      const { org, type, sort, perPage, page } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (type) qs.type = type;
      if (sort) qs.sort = sort;
      if (perPage) qs.per_page = perPage;
      if (page) qs.page = page;
      return gh(ctx, "GET", `orgs/${pathSegment(org)}/repos`, undefined, qs);
    },
  });

  // ── Workflow ────────────────────────────────────────

  rl.registerAction("workflow.list", {
    access: "read",
    description: "List workflows in a repository",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
    },
    async execute(input, ctx) {
      const { owner, repo } = input as { owner: string; repo: string };
      const data = (await gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/actions/workflows`,
      )) as Record<string, unknown>;
      return data.workflows;
    },
  });

  rl.registerAction("workflow.get", {
    access: "read",
    description: "Get a workflow",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      workflowId: {
        type: "string",
        required: true,
        description: "Workflow ID or filename",
      },
    },
    async execute(input, ctx) {
      const { owner, repo, workflowId } = input as Record<string, unknown>;
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/actions/workflows/${pathSegment(workflowId)}`,
      );
    },
  });

  rl.registerAction("workflow.dispatch", {
    access: "write",
    description: "Trigger a workflow dispatch event",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      workflowId: {
        type: "string",
        required: true,
        description: "Workflow ID or filename",
      },
      ref: {
        type: "string",
        required: true,
        description: "Branch or tag to run on",
      },
      inputs: {
        type: "object",
        required: false,
        description: "Workflow input parameters",
      },
    },
    async execute(input, ctx) {
      const { owner, repo, workflowId, ref, inputs } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { ref };
      if (inputs) body.inputs = inputs;
      await gh(
        ctx,
        "POST",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/actions/workflows/${pathSegment(workflowId)}/dispatches`,
        body,
      );
      return { success: true };
    },
  });

  rl.registerAction("workflow.enable", {
    access: "write",
    description: "Enable a workflow",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      workflowId: {
        type: "string",
        required: true,
        description: "Workflow ID",
      },
    },
    async execute(input, ctx) {
      const { owner, repo, workflowId } = input as Record<string, unknown>;
      await gh(
        ctx,
        "PUT",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/actions/workflows/${pathSegment(workflowId)}/enable`,
      );
      return { success: true };
    },
  });

  rl.registerAction("workflow.disable", {
    access: "write",
    description: "Disable a workflow",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      workflowId: {
        type: "string",
        required: true,
        description: "Workflow ID",
      },
    },
    async execute(input, ctx) {
      const { owner, repo, workflowId } = input as Record<string, unknown>;
      await gh(
        ctx,
        "PUT",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/actions/workflows/${pathSegment(workflowId)}/disable`,
      );
      return { success: true };
    },
  });

  rl.registerAction("workflow.getUsage", {
    access: "read",
    description: "Get workflow usage billing",
    inputSchema: {
      owner: {
        type: "string",
        required: true,
        description: "Repository owner",
      },
      repo: { type: "string", required: true, description: "Repository name" },
      workflowId: {
        type: "string",
        required: true,
        description: "Workflow ID",
      },
    },
    async execute(input, ctx) {
      const { owner, repo, workflowId } = input as Record<string, unknown>;
      return gh(
        ctx,
        "GET",
        `repos/${pathSegment(owner)}/${pathSegment(repo)}/actions/workflows/${pathSegment(workflowId)}/timing`,
      );
    },
  });
}
