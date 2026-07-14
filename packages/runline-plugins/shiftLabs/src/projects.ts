import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { enumSchema, PROJECT_STATUS, pathSegment, request } from "./shared.js";

export function registerProjectActions(rl: RunlinePluginAPI) {
  rl.registerAction("project.list", {
    access: "read",
    description: "List concrete Shift Labs Projects.",
    inputSchema: t.Object({
      status: t.Optional(enumSchema("Project status", PROJECT_STATUS)),
      leadUserId: t.Optional(t.String()),
      includeArchived: t.Optional(t.Boolean()),
      limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
    }),
    async execute(input, ctx) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(
        (input ?? {}) as Record<string, unknown>,
      )) {
        if (value !== undefined) params.set(key, String(value));
      }
      const body = await request<{ projects: unknown[] }>(
        ctx,
        `/v1/projects?${params}`,
      );
      return body.projects;
    },
  });

  rl.registerAction("project.get", {
    access: "read",
    description: "Get a Project and its derived Issue progress.",
    inputSchema: t.Object({ id: t.String({ description: "Project ID" }) }),
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
      name: t.String({ description: "Project name" }),
      description: t.Optional(t.String()),
      status: t.Optional(enumSchema("Project status", PROJECT_STATUS)),
      leadUserId: t.Optional(t.String()),
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
    inputSchema: t.Object({
      id: t.String({ description: "Project ID" }),
      name: t.Optional(t.String()),
      description: t.Optional(t.String()),
      status: t.Optional(enumSchema("Project status", PROJECT_STATUS)),
      leadUserId: t.Optional(t.Union([t.String(), t.Null()])),
      startAt: t.Optional(t.Union([t.String(), t.Null()])),
      targetAt: t.Optional(t.Union([t.String(), t.Null()])),
      archived: t.Optional(t.Boolean()),
    }),
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
