import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { api, getSession, identity, type Ctx } from "./shared.js";

export function registerMetadataActions(rl: RunlinePluginAPI) {
  rl.registerAction("connection.test", {
    description: "Validate Salesforce auth and return safe connection metadata",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      const sessionPromise = getSession(ctx as Ctx);
      const session = await sessionPromise;
      let limits: Record<string, unknown> | undefined;
      let limitsError: string | undefined;
      try {
        limits = (await api(
          ctx as Ctx,
          "GET",
          "/limits",
          undefined,
          undefined,
          sessionPromise,
        )) as Record<string, unknown>;
      } catch (error) {
        limitsError = error instanceof Error ? error.message : String(error);
      }
      return {
        ok: true,
        instanceUrl: session.instanceUrl,
        tokenType: session.tokenType,
        scope: session.scope,
        id: session.id,
        limits,
        limitsError,
      };
    },
  });

  rl.registerAction("auth.identity", {
    description: "Return the Salesforce OAuth identity for the current connection",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      return identity(ctx as Ctx);
    },
  });

  rl.registerAction("limits.get", {
    description: "Return Salesforce org REST API limits",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      return api(ctx as Ctx, "GET", "/limits");
    },
  });

  rl.registerAction("metadata.objects", {
    description: "List available Salesforce sObjects and metadata summaries",
    inputSchema: t.Object({}),
    async execute(_input, ctx) {
      return api(ctx as Ctx, "GET", "/sobjects");
    },
  });
}
