import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  enumSchema,
  ISSUE_PRIORITY,
  ISSUE_STATUS,
  ISSUE_VIEW_GROUP,
  ISSUE_VIEW_LAYOUT,
  ISSUE_VIEW_SORT,
  ISSUE_VIEW_VISIBILITY,
  pathSegment,
  request,
} from "./shared.js";

const viewFields = {
  name: t.String({ description: "View name" }),
  visibility: t.Optional(enumSchema("View visibility", ISSUE_VIEW_VISIBILITY)),
  layout: t.Optional(enumSchema("View layout", ISSUE_VIEW_LAYOUT)),
  projectId: t.Optional(t.String()),
  rootIssueId: t.Optional(t.String()),
  statuses: t.Optional(t.Array(enumSchema("Issue status", ISSUE_STATUS))),
  priorities: t.Optional(t.Array(enumSchema("Issue priority", ISSUE_PRIORITY))),
  assigneeUserIds: t.Optional(t.Array(t.String())),
  labels: t.Optional(t.Array(t.String())),
  startAfter: t.Optional(t.String()),
  dueBefore: t.Optional(t.String()),
  blocked: t.Optional(t.Boolean()),
  groupBy: t.Optional(enumSchema("View grouping", ISSUE_VIEW_GROUP)),
  sortBy: t.Optional(
    t.Array(enumSchema("View sort", ISSUE_VIEW_SORT), {
      minItems: 1,
      maxItems: 3,
    }),
  ),
};

export function registerIssueViewActions(rl: RunlinePluginAPI) {
  rl.registerAction("issueView.list", {
    access: "read",
    description: "List personal and organization Issue Views.",
    inputSchema: t.Object({
      visibility: t.Optional(
        enumSchema("View visibility", ISSUE_VIEW_VISIBILITY),
      ),
      limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
    }),
    async execute(input, ctx) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(
        (input ?? {}) as Record<string, unknown>,
      )) {
        if (value !== undefined) params.set(key, String(value));
      }
      const body = await request<{ views: unknown[] }>(
        ctx,
        `/v1/issue-views?${params}`,
      );
      return body.views;
    },
  });

  rl.registerAction("issueView.get", {
    access: "read",
    description: "Get an Issue View by ID.",
    inputSchema: t.Object({ id: t.String() }),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ view: unknown }>(
        ctx,
        `/v1/issue-views/${pathSegment(id)}`,
      );
      return body.view;
    },
  });

  rl.registerAction("issueView.issues", {
    access: "read",
    description: "Execute a saved Issue View and return matching Issues.",
    inputSchema: t.Object({ id: t.String() }),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ issues: unknown[] }>(
        ctx,
        `/v1/issue-views/${pathSegment(id)}/issues`,
      );
      return body.issues;
    },
  });

  rl.registerAction("issueView.create", {
    access: "write",
    description:
      "Create a bounded saved Issue query. Views never own Issue membership.",
    inputSchema: t.Object(viewFields),
    async execute(input, ctx) {
      const body = await request<{ view: unknown }>(ctx, "/v1/issue-views", {
        method: "POST",
        body: JSON.stringify(toViewBody(input as Record<string, unknown>)),
      });
      return body.view;
    },
  });

  rl.registerAction("issueView.update", {
    access: "write",
    description: "Update a saved Issue View.",
    inputSchema: t.Object({
      id: t.String(),
      ...Object.fromEntries(
        Object.entries(viewFields).map(([key, schema]) => [
          key,
          key === "name" ? t.Optional(schema) : schema,
        ]),
      ),
    }),
    async execute(input, ctx) {
      const { id, ...fields } = input as { id: string } & Record<
        string,
        unknown
      >;
      const body = await request<{ view: unknown }>(
        ctx,
        `/v1/issue-views/${pathSegment(id)}`,
        { method: "PATCH", body: JSON.stringify(toViewBody(fields, false)) },
      );
      return body.view;
    },
  });

  rl.registerAction("issueView.delete", {
    access: "write",
    description: "Delete a saved Issue View without changing any Issues.",
    inputSchema: t.Object({ id: t.String() }),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      await request<void>(ctx, `/v1/issue-views/${pathSegment(id)}`, {
        method: "DELETE",
      });
      return { deleted: true };
    },
  });
}

function toViewBody(
  input: Record<string, unknown>,
  applyDefaults = true,
): Record<string, unknown> {
  const {
    projectId,
    rootIssueId,
    statuses,
    priorities,
    assigneeUserIds,
    labels,
    startAfter,
    dueBefore,
    blocked,
    ...view
  } = input;
  const filters = Object.fromEntries(
    Object.entries({
      projectId,
      rootIssueId,
      statuses,
      priorities,
      assigneeUserIds,
      labels,
      startAfter,
      dueBefore,
      blocked,
    }).filter(([, value]) => value !== undefined),
  );
  return {
    ...view,
    ...(applyDefaults
      ? {
          visibility: view.visibility ?? "personal",
          layout: view.layout ?? "list",
        }
      : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    ...(applyDefaults && view.sortBy === undefined
      ? { sortBy: ["updatedAt"] }
      : {}),
  };
}
