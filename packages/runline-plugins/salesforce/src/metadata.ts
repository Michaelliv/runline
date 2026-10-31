import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { api, type Ctx, identity } from "./shared.js";

export function registerMetadataActions(rl: RunlinePluginAPI) {
  rl.registerAction("connection.test", {
    access: "read",
    description: "Validate Salesforce auth and return safe connection metadata",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      const limits = (await api(ctx as Ctx, "GET", "/limits")) as Record<
        string,
        unknown
      >;
      return {
        ok: true,
        instanceUrl:
          ctx.connection.config.instanceUrl ?? ctx.connection.config.loginUrl,
        limits,
      };
    },
  });

  rl.registerAction("auth.identity", {
    access: "read",
    description:
      "Return the Salesforce OAuth identity for the current connection",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      return identity(ctx as Ctx);
    },
  });

  rl.registerAction("limits.get", {
    access: "read",
    description: "Return Salesforce org REST API limits",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      return api(ctx as Ctx, "GET", "/limits");
    },
  });

  rl.registerAction("metadata.objects", {
    access: "read",
    description: "List available Salesforce sObjects and metadata summaries",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      return api(ctx as Ctx, "GET", "/sobjects");
    },
  });
}
