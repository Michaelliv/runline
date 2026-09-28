import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { profitwellCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  path: string,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, profitwellCredential, "profitwell", {
    target: "api",
    path,
    query: qs,
  });
}

export default function profitwell(rl: RunlinePluginAPI) {
  rl.setName("profitwell");
  rl.setVersion("0.1.0");
  rl.setCredential(profitwellCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "ProfitWell API access token",
      env: "PROFITWELL_ACCESS_TOKEN",
    },
  });

  rl.registerAction("company.getSettings", {
    access: "read",
    description: "Get company settings",
    inputSchema: {},
    async execute(_input, ctx) {
      return apiRequest(ctx, "company/settings/");
    },
  });

  rl.registerAction("metric.get", {
    access: "read",
    description: "Get financial metrics (daily or monthly)",
    inputSchema: {
      type: { type: "string", required: true, description: "daily or monthly" },
      month: {
        type: "string",
        required: false,
        description: "Month (YYYY-MM) — required for daily metrics",
      },
      metrics: {
        type: "string",
        required: false,
        description: "Comma-separated metric names to retrieve",
      },
      planId: {
        type: "string",
        required: false,
        description: "Filter by plan ID",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.month) qs.month = p.month;
      if (p.metrics) qs.metrics = p.metrics;
      if (p.planId) qs.plan_id = p.planId;
      const data = (await apiRequest(
        ctx,
        `metrics/${pathSegment(p.type)}`,
        qs,
      )) as Record<string, unknown>;
      return data.data;
    },
  });
}
