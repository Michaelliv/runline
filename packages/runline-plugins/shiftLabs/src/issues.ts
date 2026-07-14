import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  enumSchema,
  ISSUE_PRIORITY,
  ISSUE_SOURCE,
  ISSUE_STATUS,
  pathSegment,
  request,
} from "./shared.js";

const issueListFields = {
  status: t.Optional(enumSchema("Issue status", ISSUE_STATUS)),
  projectId: t.Optional(t.String({ minLength: 1 })),
  parentIssueId: t.Optional(t.String({ minLength: 1 })),
  assigneeUserId: t.Optional(t.String({ minLength: 1 })),
  source: t.Optional(enumSchema("Issue source", ISSUE_SOURCE)),
  cursor: t.Optional(
    t.String({ minLength: 1, description: "Next-page cursor" }),
  ),
  limit: t.Optional(
    t.Integer({
      minimum: 1,
      maximum: 100,
      description: "Max results, default 50",
    }),
  ),
};

function issueListParams(input: unknown): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(
    (input ?? {}) as Record<string, unknown>,
  )) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params;
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function registerIssueActions(rl: RunlinePluginAPI) {
  rl.registerAction("issue.list", {
    access: "read",
    description:
      "List the first page of Shift Labs Issues for the API key's organization.",
    inputSchema: t.Object(issueListFields),
    async execute(input, ctx) {
      const body = await request<{ issues: unknown[] }>(
        ctx,
        `/v1/issues?${issueListParams(input)}`,
      );
      return body.issues;
    },
  });

  rl.registerAction("issue.listPage", {
    access: "read",
    description: "List a cursor-paginated page of Shift Labs Issues.",
    inputSchema: t.Object(issueListFields),
    async execute(input, ctx) {
      return request<{ issues: unknown[]; nextCursor?: string }>(
        ctx,
        `/v1/issues?${issueListParams(input)}`,
      );
    },
  });

  rl.registerAction("issue.get", {
    access: "read",
    description: "Get a Shift Labs Issue by ID.",
    inputSchema: t.Object({
      id: t.String({ minLength: 1, description: "Issue ID" }),
    }),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ issue: unknown }>(
        ctx,
        `/v1/issues/${pathSegment(id)}`,
      );
      return body.issue;
    },
  });

  rl.registerAction("issue.create", {
    access: "write",
    description:
      "Create an Issue. Leave projectId empty for inbox work; parentIssueId requires a Project.",
    inputSchema: t.Object({
      title: t.String({
        minLength: 1,
        maxLength: 160,
        description: "Issue title",
      }),
      description: t.Optional(
        t.String({ maxLength: 20_000, description: "Issue description" }),
      ),
      projectId: t.Optional(t.String({ minLength: 1 })),
      parentIssueId: t.Optional(t.String({ minLength: 1 })),
      sortOrder: t.Optional(t.Integer({ minimum: 0 })),
      status: t.Optional(enumSchema("Issue status", ISSUE_STATUS)),
      priority: t.Optional(enumSchema("Issue priority", ISSUE_PRIORITY)),
      source: t.Optional(enumSchema("Issue source", ISSUE_SOURCE)),
      assigneeUserId: t.Optional(t.String({ minLength: 1 })),
      startAt: t.Optional(
        t.String({ description: "ISO-8601 start timestamp" }),
      ),
      dueAt: t.Optional(t.String({ description: "ISO-8601 due timestamp" })),
      deploymentId: t.Optional(t.String({ minLength: 1 })),
      workspaceId: t.Optional(t.String({ minLength: 1 })),
      sessionId: t.Optional(t.String({ minLength: 1 })),
      traceId: t.Optional(t.String({ minLength: 1 })),
      fingerprint: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
      labels: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 64 }))),
      metadata: t.Optional(
        t.Record(t.String(), t.Unknown(), { description: "Issue metadata" }),
      ),
    }),
    async execute(input, ctx) {
      const body = await request<{ issue: unknown }>(ctx, "/v1/issues", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return body.issue;
    },
  });

  rl.registerAction("issue.update", {
    access: "write",
    description:
      "Update an Issue, including Project assignment, one-level parentage, ordering, status, dates, or assignee.",
    inputSchema: t.Object(
      {
        id: t.String({ minLength: 1, description: "Issue ID" }),
        title: t.Optional(t.String({ minLength: 1, maxLength: 160 })),
        description: t.Optional(t.String({ maxLength: 20_000 })),
        projectId: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
        parentIssueId: t.Optional(
          t.Union([t.String({ minLength: 1 }), t.Null()]),
        ),
        sortOrder: t.Optional(t.Integer({ minimum: 0 })),
        status: t.Optional(enumSchema("Issue status", ISSUE_STATUS)),
        priority: t.Optional(enumSchema("Issue priority", ISSUE_PRIORITY)),
        assigneeUserId: t.Optional(
          t.Union([t.String({ minLength: 1 }), t.Null()]),
        ),
        startAt: t.Optional(t.Union([t.String(), t.Null()])),
        dueAt: t.Optional(t.Union([t.String(), t.Null()])),
        labels: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 64 }))),
        archived: t.Optional(t.Boolean()),
      },
      { minProperties: 2 },
    ),
    async execute(input, ctx) {
      const { id, ...patch } = input as { id: string } & Record<
        string,
        unknown
      >;
      const body = await request<{ issue: unknown }>(
        ctx,
        `/v1/issues/${pathSegment(id)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      return body.issue;
    },
  });

  rl.registerAction("issue.comment", {
    access: "write",
    description: "Add a comment to a Shift Labs Issue.",
    inputSchema: t.Object({
      id: t.String({ minLength: 1, description: "Issue ID" }),
      body: t.String({
        minLength: 1,
        maxLength: 20_000,
        description: "Comment body",
      }),
    }),
    async execute(input, ctx) {
      const { id, body } = input as { id: string; body: string };
      const response = await request<{ event: unknown }>(
        ctx,
        `/v1/issues/${pathSegment(id)}/comments`,
        { method: "POST", body: JSON.stringify({ body }) },
      );
      return response.event;
    },
  });

  rl.registerAction("issue.dependency.list", {
    access: "read",
    description: "List the first page of blocking and blocked-by links.",
    inputSchema: t.Object({
      id: t.String({ minLength: 1, description: "Issue ID" }),
      limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(input, ctx) {
      const { id, ...pagination } = input as { id: string; limit?: number };
      const body = await request<{ dependencies: unknown[] }>(
        ctx,
        withQuery(
          `/v1/issues/${pathSegment(id)}/dependencies`,
          issueListParams(pagination),
        ),
      );
      return body.dependencies;
    },
  });

  rl.registerAction("issue.dependency.listPage", {
    access: "read",
    description: "List a cursor-paginated page of Issue dependencies.",
    inputSchema: t.Object({
      id: t.String({ minLength: 1, description: "Issue ID" }),
      cursor: t.Optional(t.String({ minLength: 1 })),
      limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(input, ctx) {
      const { id, ...pagination } = input as {
        id: string;
        cursor?: string;
        limit?: number;
      };
      return request<{ dependencies: unknown[]; nextCursor?: string }>(
        ctx,
        withQuery(
          `/v1/issues/${pathSegment(id)}/dependencies`,
          issueListParams(pagination),
        ),
      );
    },
  });

  rl.registerAction("issue.dependency.add", {
    access: "write",
    description: "Declare that one Issue blocks another Issue.",
    inputSchema: t.Object({
      blockedIssueId: t.String({
        minLength: 1,
        description: "Issue that is blocked",
      }),
      blockingIssueId: t.String({
        minLength: 1,
        description: "Issue that blocks it",
      }),
    }),
    async execute(input, ctx) {
      const { blockedIssueId, blockingIssueId } = input as {
        blockedIssueId: string;
        blockingIssueId: string;
      };
      const body = await request<{ dependency: unknown }>(
        ctx,
        `/v1/issues/${pathSegment(blockedIssueId)}/dependencies`,
        { method: "POST", body: JSON.stringify({ blockingIssueId }) },
      );
      return body.dependency;
    },
  });

  rl.registerAction("issue.dependency.remove", {
    access: "write",
    description: "Remove an Issue dependency link.",
    inputSchema: t.Object({
      issueId: t.String({ minLength: 1 }),
      dependencyId: t.String({ minLength: 1 }),
    }),
    async execute(input, ctx) {
      const { issueId, dependencyId } = input as {
        issueId: string;
        dependencyId: string;
      };
      await request<void>(
        ctx,
        `/v1/issues/${pathSegment(issueId)}/dependencies/${pathSegment(dependencyId)}`,
        { method: "DELETE" },
      );
      return { removed: true };
    },
  });
}
