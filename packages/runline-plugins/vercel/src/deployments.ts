import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { LIST_INPUT_SCHEMA, TEAM_INPUT_SCHEMA, api, bindGetAction } from "./shared.js";

export function registerDeploymentActions(rl: RunlinePluginAPI) {
  const getAction = bindGetAction(rl);

  rl.registerAction("deployment.list", {
    description: "List Vercel deployments. Filter by project, state, target, user, or time window.",
    inputSchema: t.Object({
      ...LIST_INPUT_SCHEMA,
      projectId: t.Optional(t.String({ description: "Project ID to filter deployments" })),
      projectIds: t.Optional(t.Array(t.String(), { description: "Project IDs to filter deployments" })),
      app: t.Optional(t.String({ description: "Project name/app filter" })),
      target: t.Optional(t.String({ description: "production, preview, or a custom target" })),
      state: t.Optional(t.String({ description: "Comma-separated deployment states, e.g. BUILDING,READY,ERROR" })),
      users: t.Optional(t.String({ description: "Comma-separated Vercel user IDs" })),
    }),
    async execute(input, ctx) {
      return api(ctx, "/v7/deployments", { query: (input ?? {}) as Record<string, unknown> });
    },
  });

  getAction("deployment.get", "Get a Vercel deployment by ID or URL.", (id) => `/v13/deployments/${encodeURIComponent(id)}`);

  rl.registerAction("deployment.logs", {
    description: "Get build/deployment logs/events for a deployment. Use builds=1 for build logs and limit/since/until to avoid huge responses.",
    inputSchema: t.Object({
      ...TEAM_INPUT_SCHEMA,
      idOrUrl: t.String({ description: "Deployment ID or URL" }),
      limit: t.Optional(t.Number({ description: "Maximum events. Vercel supports -1 for all available logs" })),
      direction: t.Optional(t.String({ description: "forward or backward" })),
      follow: t.Optional(t.Number({ description: "0 or 1. Avoid 1 in short-lived agent calls unless intentionally streaming" })),
      name: t.Optional(t.String({ description: "Build ID/name" })),
      since: t.Optional(t.Number({ description: "Start timestamp in milliseconds" })),
      until: t.Optional(t.Number({ description: "End timestamp in milliseconds" })),
      statusCode: t.Optional(t.String({ description: "HTTP status filter such as 5xx" })),
      delimiter: t.Optional(t.Number({ description: "0 or 1" })),
      builds: t.Optional(t.Number({ description: "0 or 1" })),
    }),
    async execute(input, ctx) {
      const { idOrUrl, ...query } = input as Record<string, unknown>;
      return api(ctx, `/v3/deployments/${encodeURIComponent(String(idOrUrl))}/events`, { query });
    },
  });

  rl.registerAction("deployment.runtimeLogs", {
    description: "Get runtime logs for a deployment. Requires projectId and deploymentId; use limit/since/until to keep responses bounded.",
    inputSchema: t.Object({
      ...TEAM_INPUT_SCHEMA,
      projectId: t.String({ description: "Project ID" }),
      deploymentId: t.String({ description: "Deployment ID" }),
      limit: t.Optional(t.Number({ description: "Maximum logs when supported by Vercel" })),
      since: t.Optional(t.Number({ description: "Start timestamp in milliseconds" })),
      until: t.Optional(t.Number({ description: "End timestamp in milliseconds" })),
    }),
    async execute(input, ctx) {
      const { projectId, deploymentId, ...query } = input as Record<string, unknown>;
      return api(ctx, `/v1/projects/${encodeURIComponent(String(projectId))}/deployments/${encodeURIComponent(String(deploymentId))}/runtime-logs`, { query });
    },
  });

  rl.registerAction("deployment.cancel", {
    description: "Cancel a queued or building Vercel deployment.",
    inputSchema: t.Object({
      ...TEAM_INPUT_SCHEMA,
      id: t.String({ description: "Deployment ID" }),
    }),
    async execute(input, ctx) {
      const { id, ...query } = input as { id: string } & Record<string, unknown>;
      return api(ctx, `/v12/deployments/${encodeURIComponent(id)}/cancel`, { method: "PATCH", query });
    },
  });

  rl.registerAction("deployment.promote", {
    description: "Promote an existing deployment to production for a project, where supported by Vercel.",
    inputSchema: t.Object({
      ...TEAM_INPUT_SCHEMA,
      projectId: t.String({ description: "Project ID" }),
      deploymentId: t.String({ description: "Deployment ID to promote" }),
    }),
    async execute(input, ctx) {
      const { projectId, deploymentId, ...query } = input as Record<string, unknown>;
      return api(ctx, `/v10/projects/${encodeURIComponent(String(projectId))}/promote/${encodeURIComponent(String(deploymentId))}`, { method: "POST", query });
    },
  });
}
