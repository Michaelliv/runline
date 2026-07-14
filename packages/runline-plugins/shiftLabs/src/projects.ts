import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { enumSchema, PROJECT_STATUS, pathSegment, request } from "./shared.js";

const projectListFields = {
  status: t.Optional(enumSchema("Project status", PROJECT_STATUS)),
  leadUserId: t.Optional(t.String({ minLength: 1 })),
  includeArchived: t.Optional(t.Boolean()),
  cursor: t.Optional(
    t.String({ minLength: 1, description: "Next-page cursor" }),
  ),
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
    inputSchema: t.Object(projectListFields),
    async execute(input, ctx) {
      const body = await request<{ projects: unknown[] }>(
        ctx,
        `/v1/projects?${listParams(input)}`,
      );
      return body.projects;
    },
  });

  rl.registerAction("project.listPage", {
    access: "read",
    description: "List a cursor-paginated page of concrete Projects.",
    inputSchema: t.Object(projectListFields),
    async execute(input, ctx) {
      return request<{ projects: unknown[]; nextCursor?: string }>(
        ctx,
        `/v1/projects?${listParams(input)}`,
      );
    },
  });

  rl.registerAction("project.get", {
    access: "read",
    description: "Get a Project and its derived Issue progress.",
    inputSchema: t.Object({
      id: t.String({ minLength: 1, description: "Project ID" }),
    }),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const [project, progress] = await Promise.all([
        request<{ project: unknown }>(ctx, `/v1/projects/${pathSegment(id)}`),
        request<{ progress: unknown }>(
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
    inputSchema: t.Object({
      name: t.String({
        minLength: 1,
        maxLength: 160,
        description: "Project name",
      }),
      description: t.Optional(t.String({ maxLength: 20_000 })),
      status: t.Optional(enumSchema("Project status", PROJECT_STATUS)),
      leadUserId: t.Optional(t.String({ minLength: 1 })),
      startAt: t.Optional(
        t.String({ description: "ISO-8601 start timestamp" }),
      ),
      targetAt: t.Optional(
        t.String({ description: "ISO-8601 target timestamp" }),
      ),
    }),
    async execute(input, ctx) {
      const body = await request<{ project: unknown }>(ctx, "/v1/projects", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return body.project;
    },
  });

  rl.registerAction("project.update", {
    access: "write",
    description: "Update Project lifecycle, ownership, dates, or content.",
    inputSchema: t.Object(
      {
        id: t.String({ minLength: 1, description: "Project ID" }),
        name: t.Optional(t.String({ minLength: 1, maxLength: 160 })),
        description: t.Optional(t.String({ maxLength: 20_000 })),
        status: t.Optional(enumSchema("Project status", PROJECT_STATUS)),
        leadUserId: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
        startAt: t.Optional(t.Union([t.String(), t.Null()])),
        targetAt: t.Optional(t.Union([t.String(), t.Null()])),
        archived: t.Optional(t.Boolean()),
      },
      { minProperties: 2 },
    ),
    async execute(input, ctx) {
      const { id, ...patch } = input as { id: string } & Record<
        string,
        unknown
      >;
      const body = await request<{ project: unknown }>(
        ctx,
        `/v1/projects/${pathSegment(id)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      return body.project;
    },
  });
}
