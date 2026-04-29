import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  domain: string,
  email: string,
  apiToken: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${domain}/rest${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${email}:${apiToken}`)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  )
    opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok)
    throw new Error(`Jira API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) return res.json();
  return { success: true };
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    domain: (ctx.connection.config.domain as string).replace(/\/$/, ""),
    email: ctx.connection.config.email as string,
    apiToken: ctx.connection.config.apiToken as string,
  };
}

function jr(
  ctx: { connection: { config: Record<string, unknown> } },
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
) {
  const { domain, email, apiToken } = getConn(ctx);
  return apiRequest(domain, email, apiToken, method, endpoint, body, qs);
}

export default function jira(rl: RunlinePluginAPI) {
  rl.setName("jira");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    domain: {
      type: "string",
      required: true,
      description: "Jira domain (e.g. https://mycompany.atlassian.net)",
      env: "JIRA_DOMAIN",
    },
    email: {
      type: "string",
      required: true,
      description: "Jira account email",
      env: "JIRA_EMAIL",
    },
    apiToken: {
      type: "string",
      required: true,
      description: "Jira API token",
      env: "JIRA_API_TOKEN",
    },
  });

  // ── Issue ───────────────────────────────────────────

  rl.registerAction("issue.create", {
    description: "Create an issue",
    inputSchema: {
      projectKey: {
        type: "string",
        required: true,
        description: "Project key (e.g. PROJ)",
      },
      issueType: {
        type: "string",
        required: true,
        description: "Issue type (Bug, Task, Story, Epic...)",
      },
      summary: { type: "string", required: true, description: "Issue summary" },
      description: {
        type: "string",
        required: false,
        description: "Description",
      },
      assigneeId: {
        type: "string",
        required: false,
        description: "Assignee account ID",
      },
      priority: {
        type: "string",
        required: false,
        description: "Priority name (Highest, High, Medium, Low, Lowest)",
      },
      labels: { type: "array", required: false, description: "Labels" },
      parentKey: {
        type: "string",
        required: false,
        description: "Parent issue key (for subtasks)",
      },
      customFields: {
        type: "object",
        required: false,
        description: "Custom fields",
      },
    },
    async execute(input, ctx) {
      const {
        projectKey,
        issueType,
        summary,
        description: desc,
        assigneeId,
        priority,
        labels,
        parentKey,
        customFields,
      } = input as Record<string, unknown>;
      const fields: Record<string, unknown> = {
        project: { key: projectKey },
        issuetype: { name: issueType },
        summary,
      };
      if (desc) fields.description = desc;
      if (assigneeId) fields.assignee = { accountId: assigneeId };
      if (priority) fields.priority = { name: priority };
      if (labels) fields.labels = labels;
      if (parentKey) fields.parent = { key: parentKey };
      if (customFields) Object.assign(fields, customFields);
      return jr(ctx, "POST", "/api/2/issue", { fields });
    },
  });

  rl.registerAction("issue.get", {
    description: "Get an issue",
    inputSchema: {
      issueKey: {
        type: "string",
        required: true,
        description: "Issue key (e.g. PROJ-123)",
      },
      fields: {
        type: "string",
        required: false,
        description: "Comma-separated fields to return",
      },
      expand: {
        type: "string",
        required: false,
        description: "Comma-separated expansions",
      },
    },
    async execute(input, ctx) {
      const { issueKey, fields, expand } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (fields) qs.fields = fields;
      if (expand) qs.expand = expand;
      return jr(ctx, "GET", `/api/2/issue/${issueKey}`, undefined, qs);
    },
  });

  rl.registerAction("issue.search", {
    description:
      "Search issues using JQL (uses /rest/api/3/search/jql; pagination is cursor-based via nextPageToken)",
    inputSchema: {
      jql: { type: "string", required: true, description: "JQL query" },
      fields: {
        type: "array",
        required: false,
        description:
          "Fields to return (e.g. ['summary','status']). Defaults to ['*all'] to match the legacy /search behavior.",
      },
      maxResults: {
        type: "number",
        required: false,
        description: "Max results per page (server caps at 100)",
      },
      nextPageToken: {
        type: "string",
        required: false,
        description:
          "Cursor returned by the previous response. Pass to fetch the next page.",
      },
      expand: {
        type: "string",
        required: false,
        description: "Comma-separated expansions",
      },
    },
    async execute(input, ctx) {
      const { jql, fields, maxResults, nextPageToken, expand } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        jql,
        // The new endpoint returns only id+key by default; preserve the old
        // "all navigable fields" behavior unless the caller specifies.
        fields: Array.isArray(fields) ? fields : ["*all"],
      };
      if (maxResults) body.maxResults = maxResults;
      if (nextPageToken) body.nextPageToken = nextPageToken;
      if (expand) body.expand = expand;
      // Atlassian removed POST /rest/api/2|3/search (CHANGE-2046).
      // The replacement endpoint is POST /rest/api/3/search/jql with
      // cursor-based pagination.
      return jr(ctx, "POST", "/api/3/search/jql", body);
    },
  });

  rl.registerAction("issue.update", {
    description: "Update an issue",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
      fields: { type: "object", required: false, description: "Fields to set" },
      update: {
        type: "object",
        required: false,
        description: "Update operations",
      },
      transition: {
        type: "object",
        required: false,
        description: "Transition {id}",
      },
    },
    async execute(input, ctx) {
      const { issueKey, fields, update, transition } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {};
      if (fields) body.fields = fields;
      if (update) body.update = update;
      if (transition) body.transition = transition;
      return jr(ctx, "PUT", `/api/2/issue/${issueKey}`, body);
    },
  });

  rl.registerAction("issue.delete", {
    description: "Delete an issue",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
    },
    async execute(input, ctx) {
      await jr(
        ctx,
        "DELETE",
        `/api/2/issue/${(input as { issueKey: string }).issueKey}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("issue.transition", {
    description: "Transition an issue to a new status",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
      transitionId: {
        type: "string",
        required: true,
        description: "Transition ID",
      },
      comment: {
        type: "string",
        required: false,
        description: "Comment to add",
      },
    },
    async execute(input, ctx) {
      const { issueKey, transitionId, comment } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {
        transition: { id: transitionId },
      };
      if (comment) body.update = { comment: [{ add: { body: comment } }] };
      return jr(ctx, "POST", `/api/2/issue/${issueKey}/transitions`, body);
    },
  });

  rl.registerAction("issue.getTransitions", {
    description: "Get available transitions for an issue",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
    },
    async execute(input, ctx) {
      return jr(
        ctx,
        "GET",
        `/api/2/issue/${(input as { issueKey: string }).issueKey}/transitions`,
      );
    },
  });

  rl.registerAction("issue.getChangelog", {
    description: "Get issue changelog",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
    },
    async execute(input, ctx) {
      return jr(
        ctx,
        "GET",
        `/api/2/issue/${(input as { issueKey: string }).issueKey}/changelog`,
      );
    },
  });

  rl.registerAction("issue.notify", {
    description: "Send notification about an issue",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
      subject: { type: "string", required: true, description: "Email subject" },
      htmlBody: { type: "string", required: true, description: "HTML body" },
      to: {
        type: "object",
        required: true,
        description: "{users: [{accountId}], groups: [{name}]}",
      },
    },
    async execute(input, ctx) {
      const { issueKey, subject, htmlBody, to } = input as Record<
        string,
        unknown
      >;
      return jr(ctx, "POST", `/api/2/issue/${issueKey}/notify`, {
        subject,
        htmlBody,
        to,
      });
    },
  });

  // ── Issue Comment ───────────────────────────────────

  rl.registerAction("issueComment.add", {
    description: "Add a comment to an issue",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
      body: { type: "string", required: true, description: "Comment body" },
    },
    async execute(input, ctx) {
      const { issueKey, body: commentBody } = input as Record<string, unknown>;
      return jr(ctx, "POST", `/api/2/issue/${issueKey}/comment`, {
        body: commentBody,
      });
    },
  });

  rl.registerAction("issueComment.get", {
    description: "Get a comment",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
      commentId: { type: "string", required: true, description: "Comment ID" },
    },
    async execute(input, ctx) {
      const { issueKey, commentId } = input as Record<string, unknown>;
      return jr(ctx, "GET", `/api/2/issue/${issueKey}/comment/${commentId}`);
    },
  });

  rl.registerAction("issueComment.list", {
    description: "List comments on an issue",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
    },
    async execute(input, ctx) {
      return jr(
        ctx,
        "GET",
        `/api/2/issue/${(input as { issueKey: string }).issueKey}/comment`,
      );
    },
  });

  rl.registerAction("issueComment.update", {
    description: "Update a comment",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
      commentId: { type: "string", required: true, description: "Comment ID" },
      body: { type: "string", required: true, description: "New body" },
    },
    async execute(input, ctx) {
      const { issueKey, commentId, body: b } = input as Record<string, unknown>;
      return jr(ctx, "PUT", `/api/2/issue/${issueKey}/comment/${commentId}`, {
        body: b,
      });
    },
  });

  rl.registerAction("issueComment.delete", {
    description: "Delete a comment",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
      commentId: { type: "string", required: true, description: "Comment ID" },
    },
    async execute(input, ctx) {
      const { issueKey, commentId } = input as Record<string, unknown>;
      await jr(ctx, "DELETE", `/api/2/issue/${issueKey}/comment/${commentId}`);
      return { success: true };
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.get", {
    description: "Get a user by account ID",
    inputSchema: {
      accountId: { type: "string", required: true, description: "Account ID" },
    },
    async execute(input, ctx) {
      return jr(ctx, "GET", "/api/2/user", undefined, {
        accountId: (input as { accountId: string }).accountId,
      });
    },
  });

  rl.registerAction("user.search", {
    description: "Search users",
    inputSchema: {
      query: { type: "string", required: true, description: "Search query" },
      maxResults: {
        type: "number",
        required: false,
        description: "Max results",
      },
    },
    async execute(input, ctx) {
      const { query, maxResults } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { query };
      if (maxResults) qs.maxResults = maxResults;
      return jr(ctx, "GET", "/api/2/user/search", undefined, qs);
    },
  });
}
