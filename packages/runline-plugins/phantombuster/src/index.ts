import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { phantombusterCredential } from "./credentials.js";

function api(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, phantombusterCredential, "phantombuster", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

export default function phantombuster(rl: RunlinePluginAPI) {
  rl.setName("phantombuster");
  rl.setVersion("0.1.0");
  rl.setCredential(phantombusterCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Phantombuster API key",
      env: "PHANTOMBUSTER_API_KEY",
    },
  });

  rl.registerAction("agent.delete", {
    access: "write",
    description: "Delete an agent",
    inputSchema: { agentId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { agentId } = input as Record<string, unknown>;
      await api(ctx, "POST", "agents/delete", { id: agentId });
      return { success: true };
    },
  });

  rl.registerAction("agent.get", {
    access: "read",
    description: "Get agent details",
    inputSchema: { agentId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { agentId } = input as Record<string, unknown>;
      return api(ctx, "GET", "agents/fetch", undefined, { id: agentId });
    },
  });

  rl.registerAction("agent.getOutput", {
    access: "read",
    description: "Get the output of the last agent run",
    inputSchema: {
      agentId: { type: "string", required: true },
      resolveData: {
        type: "boolean",
        required: false,
        description: "Resolve the result object (default false)",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(ctx, "GET", "agents/fetch-output", undefined, {
        id: p.agentId,
      })) as Record<string, unknown>;
      if (p.resolveData) {
        const result = (await api(
          ctx,
          "GET",
          "containers/fetch-result-object",
          undefined,
          { id: data.containerId },
        )) as Record<string, unknown>;
        if (!result.resultObject) return {};
        return JSON.parse(result.resultObject as string);
      }
      return data;
    },
  });

  rl.registerAction("agent.list", {
    access: "read",
    description: "List all agents",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const agents = (await api(ctx, "GET", "agents/fetch-all")) as unknown[];
      const limit = (input as Record<string, unknown>)?.limit;
      if (limit) return agents.slice(0, limit as number);
      return agents;
    },
  });

  rl.registerAction("agent.launch", {
    access: "write",
    description: "Launch an agent",
    inputSchema: {
      agentId: { type: "string", required: true },
      arguments: {
        type: "object",
        required: false,
        description: "Arguments object to pass to the agent",
      },
      bonusArgument: {
        type: "object",
        required: false,
        description: "Bonus argument object",
      },
      resolveData: {
        type: "boolean",
        required: false,
        description: "Wait and return the container data (default false)",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { id: p.agentId };
      if (p.arguments) body.arguments = p.arguments;
      if (p.bonusArgument) body.bonusArgument = p.bonusArgument;
      const data = (await api(ctx, "POST", "agents/launch", body)) as Record<
        string,
        unknown
      >;
      if (p.resolveData) {
        return api(ctx, "GET", "containers/fetch", undefined, {
          id: data.containerId,
        });
      }
      return data;
    },
  });
}
