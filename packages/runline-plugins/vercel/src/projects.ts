import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { LIST_INPUT_SCHEMA, TEAM_INPUT_SCHEMA, api, bindGetAction } from "./shared.js";

export function registerProjectActions(rl: RunlinePluginAPI) {
  const getAction = bindGetAction(rl);

  rl.registerAction("project.list", {
    description: "List Vercel projects visible to the token.",
    inputSchema: t.Object({
      ...LIST_INPUT_SCHEMA,
      search: t.Optional(t.String({ description: "Search by project name" })),
    }),
    async execute(input, ctx) {
      const opts = (input ?? {}) as Record<string, unknown>;
      return api(ctx, "/v10/projects", { query: opts });
    },
  });

  getAction("project.get", "Get a Vercel project by ID or name.", (id) => `/v9/projects/${encodeURIComponent(id)}`);

  rl.registerAction("project.domains", {
    description: "List domains configured for a Vercel project.",
    inputSchema: t.Object({
      ...TEAM_INPUT_SCHEMA,
      projectIdOrName: t.String({ description: "Project ID or name" }),
      limit: t.Optional(t.Number({ description: "Maximum number of domains" })),
    }),
    async execute(input, ctx) {
      const { projectIdOrName, ...query } = input as Record<string, unknown>;
      return api(ctx, `/v9/projects/${encodeURIComponent(String(projectIdOrName))}/domains`, { query });
    },
  });
}
