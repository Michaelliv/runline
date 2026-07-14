import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  cursorSchema,
  enumSchema,
  idSchema,
  PROJECT_STATUS,
  pathSegment,
  request,
  type ShiftProject,
  type ShiftProjectProgress,
  STRICT_OBJECT,
  STRICT_UPDATE_OBJECT,
  timestampSchema,
} from "./shared.js";

const projectListFields = {
  status: t.Optional(enumSchema("Project status", PROJECT_STATUS)),
  leadUserId: t.Optional(idSchema("Lead user ID")),
  includeArchived: t.Optional(t.Boolean()),
  cursor: t.Optional(cursorSchema()),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
};

function listParams(input: unknown): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(
    (input ?? {}) as Record<string, unknown>,
  )) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params;
}

export function registerProjectActions(rl: RunlinePluginAPI) {
  rl.registerAction("project.list", {
    access: "read",
    description: "List the first page of concrete Shift Labs Projects.",
    inputSchema: t.Object(projectListFields, STRICT_OBJECT),
    async execute(input, ctx) {
      const body = await request<{ projects: ShiftProject[] }>(
        ctx,
        `/v1/projects?${listParams(input)}`,
      );
      return body.projects;
    },
  });

  rl.registerAction("project.listPage", {
    access: "read",
    description: "List a cursor-paginated page of concrete Projects.",
    inputSchema: t.Object(projectListFields, STRICT_OBJECT),
    async execute(input, ctx) {
      return request<{ projects: ShiftProject[]; nextCursor?: string }>(
        ctx,
        `/v1/projects?${listParams(input)}`,
      );
    },
  });

  rl.registerAction("project.get", {
    access: "read",
    description: "Get a Project and its derived Issue progress.",
    inputSchema: t.Object({ id: idSchema("Project ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const [project, progress] = await Promise.all([
        request<{ project: ShiftProject }>(
          ctx,
          `/v1/projects/${pathSegment(id)}`,
        ),
        request<{ progress: ShiftProjectProgress }>(
          ctx,
          `/v1/projects/${pathSegment(id)}/progress`,
        ),
      ]);
      return { project: project.project, progress: progress.progress };
    },
  });

  rl.registerAction("project.create", {
    access: "write",
    description: "Create a concrete Project container.",
    inputSchema: t.Object(
      {
        name: t.String({
          minLength: 1,
          maxLength: 160,
          pattern: "\\S",
          description: "Project name",
        }),
        description: t.Optional(t.String({ maxLength: 20_000 })),
        status: t.Optional(enumSchema("Project status", PROJECT_STATUS)),
        leadUserId: t.Optional(idSchema("Lead user ID")),
        startAt: t.Optional(timestampSchema("ISO-8601 start timestamp")),
        targetAt: t.Optional(timestampSchema("ISO-8601 target timestamp")),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const fields = input as Record<string, unknown>;
      assertDateOrder(fields.startAt, fields.targetAt);
      const body = await request<{ project: ShiftProject }>(
        ctx,
        "/v1/projects",
        {
          method: "POST",
          body: JSON.stringify(fields),
        },
      );
      return body.project;
    },
  });

  rl.registerAction("project.update", {
    access: "write",
    description: "Update Project lifecycle, ownership, dates, or content.",
    inputSchema: t.Object(
      {
        id: idSchema("Project ID"),
        name: t.Optional(
          t.String({ minLength: 1, maxLength: 160, pattern: "\\S" }),
        ),
        description: t.Optional(t.String({ maxLength: 20_000 })),
        status: t.Optional(enumSchema("Project status", PROJECT_STATUS)),
        leadUserId: t.Optional(t.Union([idSchema("Lead user ID"), t.Null()])),
        startAt: t.Optional(
          t.Union([timestampSchema("ISO-8601 start timestamp"), t.Null()]),
        ),
        targetAt: t.Optional(
          t.Union([timestampSchema("ISO-8601 target timestamp"), t.Null()]),
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
      assertDateOrder(patch.startAt, patch.targetAt);
      const body = await request<{ project: ShiftProject }>(
        ctx,
        `/v1/projects/${pathSegment(id)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      return body.project;
    },
  });
}

function assertDateOrder(startAt: unknown, targetAt: unknown): void {
  if (
    typeof startAt === "string" &&
    typeof targetAt === "string" &&
    startAt > targetAt
  ) {
    throw new Error("Project targetAt must not precede startAt");
  }
}
