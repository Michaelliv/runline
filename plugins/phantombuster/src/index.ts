import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.phantombuster.com/api/v2";

async function apiRequest(
  apiKey: string, method: string, path: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}${path}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { "X-Phantombuster-Key": apiKey, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Phantombuster error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export default function phantombuster(rl: RunlinePluginAPI) {
  rl.setName("phantombuster");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Phantombuster API key", env: "PHANTOMBUSTER_API_KEY" },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiKey as string;

  rl.registerAction("agent.delete", {
    description: "Delete an agent",
    inputSchema: { agentId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { agentId } = input as Record<string, unknown>;
      await apiRequest(key(ctx), "POST", "/agents/delete", { id: agentId });
      return { success: true };
    },
  });

  rl.registerAction("agent.get", {
    description: "Get agent details",
    inputSchema: { agentId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { agentId } = input as Record<string, unknown>;
      return apiRequest(key(ctx), "GET", "/agents/fetch", undefined, { id: agentId });
    },
  });

  rl.registerAction("agent.getOutput", {
    description: "Get the output of the last agent run",
    inputSchema: {
      agentId: { type: "string", required: true },
      resolveData: { type: "boolean", required: false, description: "Resolve the result object (default false)" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(key(ctx), "GET", "/agents/fetch-output", undefined, { id: p.agentId })) as Record<string, unknown>;
      if (p.resolveData) {
        const result = (await apiRequest(key(ctx), "GET", "/containers/fetch-result-object", undefined, { id: data.containerId })) as Record<string, unknown>;
        if (!result.resultObject) return {};
        return JSON.parse(result.resultObject as string);
      }
      return data;
    },
  });

  rl.registerAction("agent.list", {
    description: "List all agents",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const agents = (await apiRequest(key(ctx), "GET", "/agents/fetch-all")) as unknown[];
      const limit = (input as Record<string, unknown>)?.limit;
      if (limit) return agents.slice(0, limit as number);
      return agents;
    },
  });

  rl.registerAction("agent.launch", {
    description: "Launch an agent",
    inputSchema: {
      agentId: { type: "string", required: true },
      arguments: { type: "object", required: false, description: "Arguments object to pass to the agent" },
      bonusArgument: { type: "object", required: false, description: "Bonus argument object" },
      resolveData: { type: "boolean", required: false, description: "Wait and return the container data (default false)" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { id: p.agentId };
      if (p.arguments) body.arguments = p.arguments;
      if (p.bonusArgument) body.bonusArgument = p.bonusArgument;
      const data = (await apiRequest(key(ctx), "POST", "/agents/launch", body)) as Record<string, unknown>;
      if (p.resolveData) {
        return apiRequest(key(ctx), "GET", "/containers/fetch", undefined, { id: data.containerId });
      }
      return data;
    },
  });
}
