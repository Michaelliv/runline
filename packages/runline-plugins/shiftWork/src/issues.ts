import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  cursorSchema,
  enumSchema,
  ISSUE_PRIORITY,
  ISSUE_SOURCE,
  ISSUE_STATUS,
  idSchema,
  listParams,
  pathSegment,
  request,
  type ShiftIssue,
  type ShiftIssueDependency,
  type ShiftIssueEvent,
  STRICT_OBJECT,
  STRICT_UPDATE_OBJECT,
  timestampSchema,
  withQuery,
} from "./shared.js";

const issueListFields = {
  status: t.Optional(enumSchema("Issue status", ISSUE_STATUS)),
  projectId: t.Optional(idSchema("Project ID")),
  parentIssueId: t.Optional(idSchema("Parent Issue ID")),
  assigneeUserId: t.Optional(idSchema("Assignee user ID")),
  source: t.Optional(enumSchema("Issue source", ISSUE_SOURCE)),
  includeArchived: t.Optional(t.Boolean()),
  cursor: t.Optional(cursorSchema()),
  limit: t.Optional(
    t.Integer({
      minimum: 1,
      maximum: 100,
      description: "Max results, default 50",
    }),
  ),
};

export function registerIssueActions(rl: RunlinePluginAPI) {
  rl.registerAction("issue.list", {
    access: "read",
    description:
      "List the first page of Shift Labs Issues for the API key's organization.",
    inputSchema: t.Object(issueListFields, STRICT_OBJECT),
    async execute(input, ctx) {
      const body = await request<{ issues: ShiftIssue[] }>(
        ctx,
        `/v1/issues?${listParams(input)}`,
      );
      return body.issues;
    },
  });

  rl.registerAction("issue.listPage", {
    access: "read",
    description: "List a cursor-paginated page of Shift Labs Issues.",
    inputSchema: t.Object(issueListFields, STRICT_OBJECT),
    async execute(input, ctx) {
      return request<{ issues: ShiftIssue[]; nextCursor?: string }>(
        ctx,
        `/v1/issues?${listParams(input)}`,
      );
    },
  });

  rl.registerAction("issue.get", {
    access: "read",
    description: "Get a Shift Labs Issue by ID.",
    inputSchema: t.Object({ id: idSchema("Issue ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ issue: ShiftIssue }>(
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
    inputSchema: t.Object(
      {
        title: t.String({
          minLength: 1,
          maxLength: 160,
          pattern: "\\S",
          description: "Issue title",
        }),
        description: t.Optional(
          t.String({ maxLength: 20_000, description: "Issue description" }),
        ),
        projectId: t.Optional(idSchema("Project ID")),
        parentIssueId: t.Optional(idSchema("Parent Issue ID")),
        sortOrder: t.Optional(t.Integer({ minimum: 0 })),
        status: t.Optional(enumSchema("Issue status", ISSUE_STATUS)),
        priority: t.Optional(enumSchema("Issue priority", ISSUE_PRIORITY)),
        source: t.Optional(enumSchema("Issue source", ISSUE_SOURCE)),
        assigneeUserId: t.Optional(idSchema("Assignee user ID")),
        startAt: t.Optional(timestampSchema("ISO-8601 start timestamp")),
        dueAt: t.Optional(timestampSchema("ISO-8601 due timestamp")),
        deploymentId: t.Optional(idSchema("Deployment ID")),
        workspaceId: t.Optional(idSchema("Workspace ID")),
        sessionId: t.Optional(idSchema("Session ID")),
        traceId: t.Optional(idSchema("Trace ID")),
        fingerprint: t.Optional(
          t.String({ minLength: 1, maxLength: 512, pattern: "\\S" }),
        ),
        labels: t.Optional(
          t.Array(t.String({ minLength: 1, maxLength: 64, pattern: "\\S" })),
        ),
        metadata: t.Optional(
          t.Record(t.String(), t.Unknown(), { description: "Issue metadata" }),
        ),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const fields = input as Record<string, unknown>;
      if (
        fields.parentIssueId !== undefined &&
        fields.projectId === undefined
      ) {
        throw new Error("projectId is required when parentIssueId is set");
      }
      assertDateOrder(
        fields.startAt,
        fields.dueAt,
        "Issue dueAt must not precede startAt",
      );
      const body = await request<{ issue: ShiftIssue }>(ctx, "/v1/issues", {
        method: "POST",
        body: JSON.stringify(fields),
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
        id: idSchema("Issue ID"),
        title: t.Optional(
          t.String({ minLength: 1, maxLength: 160, pattern: "\\S" }),
        ),
        description: t.Optional(t.String({ maxLength: 20_000 })),
        projectId: t.Optional(t.Union([idSchema("Project ID"), t.Null()])),
        parentIssueId: t.Optional(
          t.Union([idSchema("Parent Issue ID"), t.Null()]),
        ),
        sortOrder: t.Optional(t.Integer({ minimum: 0 })),
        status: t.Optional(enumSchema("Issue status", ISSUE_STATUS)),
        priority: t.Optional(enumSchema("Issue priority", ISSUE_PRIORITY)),
        assigneeUserId: t.Optional(
          t.Union([idSchema("Assignee user ID"), t.Null()]),
        ),
        startAt: t.Optional(
          t.Union([timestampSchema("ISO-8601 start timestamp"), t.Null()]),
        ),
        dueAt: t.Optional(
          t.Union([timestampSchema("ISO-8601 due timestamp"), t.Null()]),
        ),
        labels: t.Optional(
          t.Array(t.String({ minLength: 1, maxLength: 64, pattern: "\\S" })),
        ),
        archived: t.Optional(t.Boolean()),
      },
      STRICT_UPDATE_OBJECT,
    ),
    async execute(input, ctx) {
      const { id, ...patch } = input as { id: string } & Record<
        string,
        unknown
      >;
      assertDateOrder(
        patch.startAt,
        patch.dueAt,
        "Issue dueAt must not precede startAt",
      );
      const body = await request<{ issue: ShiftIssue }>(
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
    inputSchema: t.Object(
      {
        id: idSchema("Issue ID"),
        body: t.String({
          minLength: 1,
          maxLength: 20_000,
          pattern: "\\S",
          description: "Comment body",
        }),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { id, body } = input as { id: string; body: string };
      const response = await request<{ event: ShiftIssueEvent }>(
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
    inputSchema: t.Object(
      {
        id: idSchema("Issue ID"),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { id, ...pagination } = input as { id: string; limit?: number };
      const body = await request<{ dependencies: ShiftIssueDependency[] }>(
        ctx,
        withQuery(
          `/v1/issues/${pathSegment(id)}/dependencies`,
          listParams(pagination),
        ),
      );
      return body.dependencies;
    },
  });

  rl.registerAction("issue.dependency.listPage", {
    access: "read",
    description: "List a cursor-paginated page of Issue dependencies.",
    inputSchema: t.Object(
      {
        id: idSchema("Issue ID"),
        cursor: t.Optional(cursorSchema()),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { id, ...pagination } = input as {
        id: string;
        cursor?: string;
        limit?: number;
      };
      return request<{
        dependencies: ShiftIssueDependency[];
        nextCursor?: string;
      }>(
        ctx,
        withQuery(
          `/v1/issues/${pathSegment(id)}/dependencies`,
          listParams(pagination),
        ),
      );
    },
  });

  rl.registerAction("issue.dependency.add", {
    access: "write",
    description: "Declare that one Issue blocks another Issue.",
    inputSchema: t.Object(
      {
        blockedIssueId: idSchema("Issue that is blocked"),
        blockingIssueId: idSchema("Issue that blocks it"),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { blockedIssueId, blockingIssueId } = input as {
        blockedIssueId: string;
        blockingIssueId: string;
      };
      if (blockedIssueId === blockingIssueId) {
        throw new Error("An Issue cannot block itself");
      }
      const body = await request<{ dependency: ShiftIssueDependency }>(
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
    inputSchema: t.Object(
      {
        issueId: idSchema("Issue ID"),
        dependencyId: idSchema("Dependency ID"),
      },
      STRICT_OBJECT,
    ),
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

function assertDateOrder(start: unknown, end: unknown, message: string): void {
  if (typeof start === "string" && typeof end === "string" && start > end) {
    throw new Error(message);
  }
}
