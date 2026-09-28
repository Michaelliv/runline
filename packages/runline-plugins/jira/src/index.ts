import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { jiraCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function jr(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, jiraCredential, "jira", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: body }
      : {}),
  });
}

export default function jira(rl: RunlinePluginAPI) {
  rl.setName("jira");
  rl.setVersion("0.1.0");
  rl.setCredential(jiraCredential);

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
    access: "write",
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
      return jr(ctx, "POST", "api/2/issue", { fields });
    },
  });

  rl.registerAction("issue.get", {
    access: "read",
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
      return jr(ctx, "GET", `api/2/issue/${seg(issueKey)}`, undefined, qs);
    },
  });

  rl.registerAction("issue.search", {
    access: "read",
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
      return jr(ctx, "POST", "api/3/search/jql", body);
    },
  });

  rl.registerAction("issue.update", {
    access: "write",
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
      return jr(ctx, "PUT", `api/2/issue/${seg(issueKey)}`, body);
    },
  });

  rl.registerAction("issue.delete", {
    access: "write",
    description: "Delete an issue",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
    },
    async execute(input, ctx) {
      await jr(
        ctx,
        "DELETE",
        `api/2/issue/${seg((input as { issueKey: string }).issueKey)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("issue.transition", {
    access: "write",
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
      return jr(ctx, "POST", `api/2/issue/${seg(issueKey)}/transitions`, body);
    },
  });

  rl.registerAction("issue.getTransitions", {
    access: "read",
    description: "Get available transitions for an issue",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
    },
    async execute(input, ctx) {
      return jr(
        ctx,
        "GET",
        `api/2/issue/${seg((input as { issueKey: string }).issueKey)}/transitions`,
      );
    },
  });

  rl.registerAction("issue.getChangelog", {
    access: "read",
    description: "Get issue changelog",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
    },
    async execute(input, ctx) {
      return jr(
        ctx,
        "GET",
        `api/2/issue/${seg((input as { issueKey: string }).issueKey)}/changelog`,
      );
    },
  });

  rl.registerAction("issue.notify", {
    access: "write",
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
      return jr(ctx, "POST", `api/2/issue/${seg(issueKey)}/notify`, {
        subject,
        htmlBody,
        to,
      });
    },
  });

  // ── Issue Comment ───────────────────────────────────

  rl.registerAction("issueComment.add", {
    access: "write",
    description: "Add a comment to an issue",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
      body: { type: "string", required: true, description: "Comment body" },
    },
    async execute(input, ctx) {
      const { issueKey, body: commentBody } = input as Record<string, unknown>;
      return jr(ctx, "POST", `api/2/issue/${seg(issueKey)}/comment`, {
        body: commentBody,
      });
    },
  });

  rl.registerAction("issueComment.get", {
    access: "read",
    description: "Get a comment",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
      commentId: { type: "string", required: true, description: "Comment ID" },
    },
    async execute(input, ctx) {
      const { issueKey, commentId } = input as Record<string, unknown>;
      return jr(
        ctx,
        "GET",
        `api/2/issue/${seg(issueKey)}/comment/${seg(commentId)}`,
      );
    },
  });

  rl.registerAction("issueComment.list", {
    access: "read",
    description: "List comments on an issue",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
    },
    async execute(input, ctx) {
      return jr(
        ctx,
        "GET",
        `api/2/issue/${seg((input as { issueKey: string }).issueKey)}/comment`,
      );
    },
  });

  rl.registerAction("issueComment.update", {
    access: "write",
    description: "Update a comment",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
      commentId: { type: "string", required: true, description: "Comment ID" },
      body: { type: "string", required: true, description: "New body" },
    },
    async execute(input, ctx) {
      const { issueKey, commentId, body: b } = input as Record<string, unknown>;
      return jr(
        ctx,
        "PUT",
        `api/2/issue/${seg(issueKey)}/comment/${seg(commentId)}`,
        {
          body: b,
        },
      );
    },
  });

  rl.registerAction("issueComment.delete", {
    access: "write",
    description: "Delete a comment",
    inputSchema: {
      issueKey: { type: "string", required: true, description: "Issue key" },
      commentId: { type: "string", required: true, description: "Comment ID" },
    },
    async execute(input, ctx) {
      const { issueKey, commentId } = input as Record<string, unknown>;
      await jr(
        ctx,
        "DELETE",
        `api/2/issue/${seg(issueKey)}/comment/${seg(commentId)}`,
      );
      return { success: true };
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.get", {
    access: "read",
    description: "Get a user by account ID",
    inputSchema: {
      accountId: { type: "string", required: true, description: "Account ID" },
    },
    async execute(input, ctx) {
      return jr(ctx, "GET", "api/2/user", undefined, {
        accountId: (input as { accountId: string }).accountId,
      });
    },
  });

  rl.registerAction("user.search", {
    access: "read",
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
      return jr(ctx, "GET", "api/2/user/search", undefined, qs);
    },
  });
}
