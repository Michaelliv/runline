import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { TEAM_INPUT_SCHEMA, api } from "./shared.js";

const targetSchema = t.Union([t.String(), t.Array(t.String())], {
  description: "production, preview, development, custom environment, or array of targets",
});

function normalizeEnvBody(body: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...body };
  if (typeof normalized.target === "string") normalized.target = [normalized.target];
  return normalized;
}

function assertCreateEnvInput(body: Record<string, unknown>): void {
  if (!body.key || !body.value || !body.type) {
    throw new Error("env.set create requires key, value, and type");
  }
  if (!body.target && !body.customEnvironmentIds) {
    throw new Error("env.set create requires target or customEnvironmentIds");
  }
}

export function registerEnvActions(rl: RunlinePluginAPI) {
  rl.registerAction("env.list", {
    description: "List environment variables for a Vercel project.",
    inputSchema: t.Object({
      ...TEAM_INPUT_SCHEMA,
      projectIdOrName: t.String({ description: "Project ID or name" }),
      target: t.Optional(t.String({ description: "production, preview, development, or custom environment" })),
      gitBranch: t.Optional(t.String({ description: "Git branch filter" })),
      decrypt: t.Optional(t.Boolean({ description: "Ask Vercel to include decrypted values when permitted" })),
      source: t.Optional(t.String({ description: "Environment variable source filter" })),
    }),
    async execute(input, ctx) {
      const { projectIdOrName, ...query } = input as Record<string, unknown>;
      return api(ctx, `/v10/projects/${encodeURIComponent(String(projectIdOrName))}/env`, { query });
    },
  });

  rl.registerAction("env.get", {
    description: "Get one environment variable by ID for a Vercel project, including decrypted value when permitted.",
    inputSchema: t.Object({
      ...TEAM_INPUT_SCHEMA,
      projectIdOrName: t.String({ description: "Project ID or name" }),
      id: t.String({ description: "Environment variable ID" }),
    }),
    async execute(input, ctx) {
      const { projectIdOrName, id, ...query } = input as Record<string, unknown>;
      return api(ctx, `/v1/projects/${encodeURIComponent(String(projectIdOrName))}/env/${encodeURIComponent(String(id))}`, { query });
    },
  });

  rl.registerAction("env.set", {
    description: "Create or update a Vercel project environment variable. Without id, creates a variable and requires key, value, type, and target/customEnvironmentIds. With id, updates that exact variable. Be explicit about target to avoid changing the wrong environment.",
    inputSchema: t.Object({
      ...TEAM_INPUT_SCHEMA,
      projectIdOrName: t.String({ description: "Project ID or name" }),
      id: t.Optional(t.String({ description: "Environment variable ID. When provided, env.set updates instead of creating." })),
      key: t.Optional(t.String({ description: "Variable name" })),
      value: t.Optional(t.String({ description: "Variable value" })),
      target: t.Optional(targetSchema),
      customEnvironmentIds: t.Optional(t.Array(t.String(), { description: "Custom environment IDs for custom-environment scoped variables" })),
      type: t.Optional(t.String({ description: "Vercel env var type: system, encrypted, plain, or sensitive" })),
      gitBranch: t.Optional(t.String({ description: "Git branch for branch-scoped preview variables" })),
      comment: t.Optional(t.String({ description: "Optional comment" })),
      variables: t.Optional(t.Array(t.Object({}, { description: "Raw Vercel env var objects for batch create" }))),
    }),
    async execute(input, ctx) {
      const { projectIdOrName, id, teamId, slug, variables, ...fields } = input as Record<string, unknown>;
      const query = { teamId, slug };
      if (id) {
        return api(ctx, `/v9/projects/${encodeURIComponent(String(projectIdOrName))}/env/${encodeURIComponent(String(id))}`, {
          method: "PATCH",
          query,
          body: normalizeEnvBody(fields),
        });
      }
      if (Array.isArray(variables)) {
        return api(ctx, `/v10/projects/${encodeURIComponent(String(projectIdOrName))}/env`, {
          method: "POST",
          query,
          body: variables.map((item) => normalizeEnvBody(item as Record<string, unknown>)),
        });
      }
      const body = normalizeEnvBody(fields);
      assertCreateEnvInput(body);
      return api(ctx, `/v10/projects/${encodeURIComponent(String(projectIdOrName))}/env`, { method: "POST", query, body });
    },
  });

  rl.registerAction("env.delete", {
    description: "Delete an environment variable from a Vercel project. This removes the variable for the specified project/environment scope.",
    inputSchema: t.Object({
      ...TEAM_INPUT_SCHEMA,
      projectIdOrName: t.String({ description: "Project ID or name" }),
      id: t.String({ description: "Environment variable ID" }),
      customEnvironmentId: t.Optional(t.String({ description: "Custom environment ID when required" })),
    }),
    async execute(input, ctx) {
      const { projectIdOrName, id, customEnvironmentId, ...query } = input as Record<string, unknown>;
      return api(ctx, `/v9/projects/${encodeURIComponent(String(projectIdOrName))}/env/${encodeURIComponent(String(id))}`, {
        method: "DELETE",
        query: { ...query, customEnvironmentId },
      });
    },
  });
}
