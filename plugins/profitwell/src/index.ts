import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.profitwell.com/v2";

async function apiRequest(
  token: string, endpoint: string, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const res = await fetch(url.toString(), { headers: { Authorization: token } });
  if (!res.ok) throw new Error(`ProfitWell error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function profitwell(rl: RunlinePluginAPI) {
  rl.setName("profitwell");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "ProfitWell API access token", env: "PROFITWELL_ACCESS_TOKEN" },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.accessToken as string;

  rl.registerAction("company.getSettings", {
    description: "Get company settings",
    inputSchema: {},
    async execute(_input, ctx) {
      return apiRequest(key(ctx), "/company/settings/");
    },
  });

  rl.registerAction("metric.get", {
    description: "Get financial metrics (daily or monthly)",
    inputSchema: {
      type: { type: "string", required: true, description: "daily or monthly" },
      month: { type: "string", required: false, description: "Month (YYYY-MM) — required for daily metrics" },
      metrics: { type: "string", required: false, description: "Comma-separated metric names to retrieve" },
      planId: { type: "string", required: false, description: "Filter by plan ID" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.month) qs.month = p.month;
      if (p.metrics) qs.metrics = p.metrics;
      if (p.planId) qs.plan_id = p.planId;
      const data = (await apiRequest(key(ctx), `/metrics/${p.type}`, qs)) as Record<string, unknown>;
      return data.data;
    },
  });
}
