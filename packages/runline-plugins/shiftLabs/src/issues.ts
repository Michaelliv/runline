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

export function registerIssueActions(rl: RunlinePluginAPI) {
  rl.registerAction("issue.list", {
    access: "read",
    description: "List Shift Labs Issues for the API key's organization.",
    inputSchema: t.Object({
      status: t.Optional(enumSchema("Issue status", ISSUE_STATUS)),
      projectId: t.Optional(t.String()),
      parentIssueId: t.Optional(t.String()),
      assigneeUserId: t.Optional(t.String()),
      source: t.Optional(enumSchema("Issue source", ISSUE_SOURCE)),
      limit: t.Optional(t.Number({ description: "Max results, default 50" })),
    }),
    async execute(input, ctx) {
      const fields = (input ?? {}) as Record<string, unknown>;
      const params = new URLSearchParams();
      for (const key of [
        "status",
        "projectId",
        "parentIssueId",
        "assigneeUserId",
        "source",
        "limit",
      ]) {
        const value = fields[key];
        if (value !== undefined) params.set(key, String(value));
      }
      const body = await request<{ issues: unknown[] }>(
        ctx,
        `/v1/issues?${params}`,
      );
      return body.issues;
    },
  });

  rl.registerAction("issue.get", {
    access: "read",
    description: "Get a Shift Labs Issue by ID.",
    inputSchema: t.Object({ id: t.String({ description: "Issue ID" }) }),
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
      title: t.String({ description: "Issue title" }),
      description: t.Optional(t.String({ description: "Issue description" })),
      projectId: t.Optional(t.String()),
      parentIssueId: t.Optional(t.String()),
      sortOrder: t.Optional(t.Number({ minimum: 0 })),
      status: t.Optional(enumSchema("Issue status", ISSUE_STATUS)),
      priority: t.Optional(enumSchema("Issue priority", ISSUE_PRIORITY)),
      source: t.Optional(enumSchema("Issue source", ISSUE_SOURCE)),
      assigneeUserId: t.Optional(t.String()),
      startAt: t.Optional(
        t.String({ description: "ISO-8601 start timestamp" }),
      ),
      dueAt: t.Optional(t.String({ description: "ISO-8601 due timestamp" })),
      deploymentId: t.Optional(t.String()),
      workspaceId: t.Optional(t.String()),
      sessionId: t.Optional(t.String()),
      traceId: t.Optional(t.String()),
      fingerprint: t.Optional(t.String()),
      labels: t.Optional(t.Array(t.String())),
      metadata: t.Optional(t.Object({}, { description: "Issue metadata" })),
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
    inputSchema: t.Object({
      id: t.String({ description: "Issue ID" }),
      title: t.Optional(t.String()),
      description: t.Optional(t.String()),
      projectId: t.Optional(t.Union([t.String(), t.Null()])),
      parentIssueId: t.Optional(t.Union([t.String(), t.Null()])),
      sortOrder: t.Optional(t.Number({ minimum: 0 })),
      status: t.Optional(enumSchema("Issue status", ISSUE_STATUS)),
      priority: t.Optional(enumSchema("Issue priority", ISSUE_PRIORITY)),
      assigneeUserId: t.Optional(t.Union([t.String(), t.Null()])),
      startAt: t.Optional(t.Union([t.String(), t.Null()])),
      dueAt: t.Optional(t.Union([t.String(), t.Null()])),
      labels: t.Optional(t.Array(t.String())),
    }),
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
      id: t.String({ description: "Issue ID" }),
      body: t.String({ description: "Comment body" }),
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
    description: "List blocking and blocked-by links for an Issue.",
    inputSchema: t.Object({ id: t.String({ description: "Issue ID" }) }),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ dependencies: unknown[] }>(
        ctx,
        `/v1/issues/${pathSegment(id)}/dependencies`,
      );
      return body.dependencies;
    },
  });

  rl.registerAction("issue.dependency.add", {
    access: "write",
    description: "Declare that one Issue blocks another Issue.",
    inputSchema: t.Object({
      blockedIssueId: t.String({ description: "Issue that is blocked" }),
      blockingIssueId: t.String({ description: "Issue that blocks it" }),
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
      issueId: t.String(),
      dependencyId: t.String(),
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
