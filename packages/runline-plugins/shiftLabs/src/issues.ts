import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  enumSchema,
  ISSUE_KIND,
  ISSUE_PRIORITY,
  ISSUE_SEVERITY,
  ISSUE_SOURCE,
  ISSUE_STATUS,
  request,
} from "./shared.js";

export function registerIssueActions(rl: RunlinePluginAPI) {
  rl.registerAction("issue.list", {
    description: "List Shift Labs issues for the API key's organization.",
    inputSchema: t.Object({
      status: t.Optional(enumSchema("Issue status", ISSUE_STATUS)),
      assigneeUserId: t.Optional(t.String()),
      source: t.Optional(enumSchema("Issue source", ISSUE_SOURCE)),
      limit: t.Optional(t.Number({ description: "Max results, default 50" })),
    }),
    async execute(input, ctx) {
      const fields = (input ?? {}) as Record<string, unknown>;
      const params = new URLSearchParams();
      for (const key of ["status", "assigneeUserId", "source", "limit"]) {
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
    description: "Get a Shift Labs issue by ID.",
    inputSchema: t.Object({ id: t.String({ description: "Issue ID" }) }),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ issue: unknown }>(
        ctx,
        `/v1/issues/${encodeURIComponent(id)}`,
      );
      return body.issue;
    },
  });

  rl.registerAction("issue.create", {
    description: "Create a Shift Labs issue. The issue starts in triage.",
    inputSchema: t.Object({
      title: t.String({ description: "Issue title" }),
      description: t.Optional(t.String({ description: "Issue description" })),
      kind: t.Optional(enumSchema("Issue kind", ISSUE_KIND)),
      priority: t.Optional(enumSchema("Issue priority", ISSUE_PRIORITY)),
      severity: t.Optional(enumSchema("Issue severity", ISSUE_SEVERITY)),
      source: t.Optional(enumSchema("Issue source", ISSUE_SOURCE)),
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

  rl.registerAction("issue.comment", {
    description: "Add a comment to a Shift Labs issue.",
    inputSchema: t.Object({
      id: t.String({ description: "Issue ID" }),
      body: t.String({ description: "Comment body" }),
    }),
    async execute(input, ctx) {
      const { id, body } = input as { id: string; body: string };
      const response = await request<{ event: unknown }>(
        ctx,
        `/v1/issues/${encodeURIComponent(id)}/comments`,
        { method: "POST", body: JSON.stringify({ body }) },
      );
      return response.event;
    },
  });
}
