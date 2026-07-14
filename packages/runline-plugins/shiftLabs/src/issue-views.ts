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
  name: t.String({ minLength: 1, maxLength: 120, description: "View name" }),
  visibility: t.Optional(t.Literal("organization")),
  layout: t.Optional(enumSchema("View layout", ISSUE_VIEW_LAYOUT)),
  projectId: t.Optional(t.String({ minLength: 1 })),
  rootIssueId: t.Optional(t.String({ minLength: 1 })),
  statuses: t.Optional(
    t.Array(enumSchema("Issue status", ISSUE_STATUS), { maxItems: 5 }),
  ),
  priorities: t.Optional(
    t.Array(enumSchema("Issue priority", ISSUE_PRIORITY), { maxItems: 5 }),
  ),
  assigneeUserIds: t.Optional(
    t.Array(t.String({ minLength: 1 }), { maxItems: 20 }),
  ),
  labels: t.Optional(
    t.Array(t.String({ minLength: 1, maxLength: 64 }), { maxItems: 20 }),
  ),
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
  const listFields = {
    visibility: t.Optional(
      enumSchema("View visibility", ISSUE_VIEW_VISIBILITY),
    ),
    cursor: t.Optional(
      t.String({ minLength: 1, description: "Next-page cursor" }),
    ),
    limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
  };

  rl.registerAction("issueView.list", {
    access: "read",
    description:
      "List the first page of personal and organization Issue Views.",
    inputSchema: t.Object(listFields),
    async execute(input, ctx) {
      const body = await request<{ views: unknown[] }>(
        ctx,
        `/v1/issue-views?${listParams(input)}`,
      );
      return body.views;
    },
  });

  rl.registerAction("issueView.listPage", {
    access: "read",
    description: "List a cursor-paginated page of Issue Views.",
    inputSchema: t.Object(listFields),
    async execute(input, ctx) {
      return request<{ views: unknown[]; nextCursor?: string }>(
        ctx,
        `/v1/issue-views?${listParams(input)}`,
      );
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
    description: "Execute the first page of a saved Issue View.",
    inputSchema: t.Object({
      id: t.String({ minLength: 1 }),
      limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(input, ctx) {
      const { id, ...pagination } = input as {
        id: string;
        limit?: number;
      };
      const body = await request<{ issues: unknown[] }>(
        ctx,
        withQuery(
          `/v1/issue-views/${pathSegment(id)}/issues`,
          listParams(pagination),
        ),
      );
      return body.issues;
    },
  });

  rl.registerAction("issueView.issuesPage", {
    access: "read",
    description: "Execute a cursor-paginated page of a saved Issue View.",
    inputSchema: t.Object({
      id: t.String({ minLength: 1 }),
      cursor: t.Optional(t.String({ minLength: 1 })),
      limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(input, ctx) {
      const { id, ...pagination } = input as {
        id: string;
        cursor?: string;
        limit?: number;
      };
      return request<{ issues: unknown[]; nextCursor?: string }>(
        ctx,
        withQuery(
          `/v1/issue-views/${pathSegment(id)}/issues`,
          listParams(pagination),
        ),
      );
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
    description:
      "Patch a saved Issue View. Null filter values remove that filter without replacing unrelated filters.",
    inputSchema: t.Object(
      {
        id: t.String({ minLength: 1 }),
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        visibility: t.Optional(t.Literal("organization")),
        layout: t.Optional(enumSchema("View layout", ISSUE_VIEW_LAYOUT)),
        projectId: optionalNullableString(),
        rootIssueId: optionalNullableString(),
        statuses: optionalNullableArray(
          enumSchema("Issue status", ISSUE_STATUS),
          5,
        ),
        priorities: optionalNullableArray(
          enumSchema("Issue priority", ISSUE_PRIORITY),
          5,
        ),
        assigneeUserIds: optionalNullableArray(t.String({ minLength: 1 }), 20),
        labels: optionalNullableArray(
          t.String({ minLength: 1, maxLength: 64 }),
          20,
        ),
        startAfter: optionalNullableString(),
        dueBefore: optionalNullableString(),
        blocked: t.Optional(t.Union([t.Boolean(), t.Null()])),
        groupBy: t.Optional(
          t.Union([enumSchema("View grouping", ISSUE_VIEW_GROUP), t.Null()]),
        ),
        sortBy: t.Optional(
          t.Array(enumSchema("View sort", ISSUE_VIEW_SORT), {
            minItems: 1,
            maxItems: 3,
          }),
        ),
      },
      { minProperties: 2 },
    ),
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

function listParams(input: unknown): URLSearchParams {
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

function optionalNullableString() {
  return t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()]));
}

function optionalNullableArray<T extends t.TSchema>(item: T, maxItems: number) {
  return t.Optional(t.Union([t.Array(item, { maxItems }), t.Null()]));
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
          visibility: view.visibility ?? "organization",
          layout: view.layout ?? "list",
        }
      : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    ...(applyDefaults && view.sortBy === undefined
      ? { sortBy: ["updatedAt"] }
      : {}),
  };
}
