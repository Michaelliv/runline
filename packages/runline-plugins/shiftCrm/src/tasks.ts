import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  CRM_BASE,
  CRM_TASK_PRIORITY,
  CRM_TASK_STATUS,
  type CrmTask,
  createRecordFields,
  enumSchema,
  idSchema,
  listParams,
  nullableTimestamp,
  paginationFields,
  pathSegment,
  request,
  STRICT_OBJECT,
  STRICT_UPDATE_OBJECT,
  timestampSchema,
  updateRecordFields,
  withQuery,
} from "./shared.js";

const taskListFields = {
  linkedRecordId: t.Optional(idSchema("Filter by linked CRM record ID")),
  status: t.Optional(enumSchema("Task status", CRM_TASK_STATUS)),
  includeArchived: t.Optional(t.Boolean()),
  ...paginationFields(),
};

export function registerTaskActions(rl: RunlinePluginAPI) {
  rl.registerAction("task.list", {
    access: "read",
    description: "List the first page of CRM tasks.",
    inputSchema: t.Object(taskListFields, STRICT_OBJECT),
    async execute(input, ctx) {
      const body = await request<{ tasks: CrmTask[] }>(
        ctx,
        withQuery(`${CRM_BASE}/tasks`, listParams(input)),
      );
      return body.tasks;
    },
  });

  rl.registerAction("task.listPage", {
    access: "read",
    description: "List a cursor-paginated page of CRM tasks.",
    inputSchema: t.Object(taskListFields, STRICT_OBJECT),
    async execute(input, ctx) {
      return request<{ tasks: CrmTask[]; nextCursor?: string }>(
        ctx,
        withQuery(`${CRM_BASE}/tasks`, listParams(input)),
      );
    },
  });

  rl.registerAction("task.get", {
    access: "read",
    description: "Get a CRM task by record ID.",
    inputSchema: t.Object({ id: idSchema("Task record ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ task: CrmTask }>(
        ctx,
        `${CRM_BASE}/tasks/${pathSegment(id)}`,
      );
      return body.task;
    },
  });

  rl.registerAction("task.create", {
    access: "write",
    description:
      "Create a CRM follow-up task, optionally linked to records via relationships.",
    inputSchema: t.Object(
      {
        title: t.String({
          minLength: 1,
          maxLength: 500,
          pattern: "\\S",
          description: "Task title",
        }),
        status: t.Optional(enumSchema("Task status", CRM_TASK_STATUS)),
        priority: t.Optional(enumSchema("Task priority", CRM_TASK_PRIORITY)),
        dueAt: t.Optional(timestampSchema("ISO-8601 due timestamp")),
        assignedTo: t.Optional(idSchema("Assigned Shift user ID")),
        ...createRecordFields(),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const body = await request<{ task: CrmTask }>(ctx, `${CRM_BASE}/tasks`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      return body.task;
    },
  });

  rl.registerAction("task.update", {
    access: "write",
    description:
      "Update or archive a CRM task: title, status, priority, due date, or assignee.",
    inputSchema: t.Object(
      {
        id: idSchema("Task record ID"),
        title: t.Optional(
          t.String({ minLength: 1, maxLength: 500, pattern: "\\S" }),
        ),
        status: t.Optional(enumSchema("Task status", CRM_TASK_STATUS)),
        priority: t.Optional(enumSchema("Task priority", CRM_TASK_PRIORITY)),
        dueAt: nullableTimestamp("ISO-8601 due timestamp"),
        assignedTo: t.Optional(
          t.Union([idSchema("Assigned Shift user ID"), t.Null()]),
        ),
        ...updateRecordFields(),
      },
      STRICT_UPDATE_OBJECT,
    ),
    async execute(input, ctx) {
      const { id, ...patch } = input as { id: string } & Record<
        string,
        unknown
      >;
      const body = await request<{ task: CrmTask }>(
        ctx,
        `${CRM_BASE}/tasks/${pathSegment(id)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      return body.task;
    },
  });
}
