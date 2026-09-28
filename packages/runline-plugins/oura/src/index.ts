import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { ouraCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  endpoint: string,
  qs: Record<string, unknown> = {},
): Promise<unknown> {
  return credentialJson(ctx, ouraCredential, "oura", {
    target: "api",
    path: endpoint,
    query: qs,
  });
}

function formatDate(d?: unknown): string | undefined {
  if (!d) return undefined;
  return String(d).split("T")[0];
}

export default function oura(rl: RunlinePluginAPI) {
  rl.setName("oura");
  rl.setVersion("0.1.0");
  rl.setCredential(ouraCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Oura personal access token",
      env: "OURA_ACCESS_TOKEN",
    },
  });

  rl.registerAction("profile.get", {
    access: "read",
    description: "Get the user's personal information",
    inputSchema: {},
    async execute(_input, ctx) {
      return apiRequest(ctx, "usercollection/personal_info");
    },
  });

  const summaryEndpoints = [
    {
      name: "summary.activity",
      path: "usercollection/daily_activity",
      description: "Get daily activity summary",
    },
    {
      name: "summary.readiness",
      path: "usercollection/daily_readiness",
      description: "Get daily readiness summary",
    },
    {
      name: "summary.sleep",
      path: "usercollection/daily_sleep",
      description: "Get daily sleep summary",
    },
  ];

  for (const ep of summaryEndpoints) {
    rl.registerAction(ep.name, {
      access: "read",
      description: ep.description,
      inputSchema: {
        startDate: {
          type: "string",
          required: false,
          description: "Start date (YYYY-MM-DD), defaults to a week ago",
        },
        endDate: {
          type: "string",
          required: false,
          description: "End date (YYYY-MM-DD), defaults to today",
        },
        limit: {
          type: "number",
          required: false,
          description: "Max results (default all)",
        },
      },
      async execute(input, ctx) {
        const p = (input ?? {}) as Record<string, unknown>;
        const qs: Record<string, unknown> = {};
        if (p.startDate) qs.start_date = formatDate(p.startDate);
        if (p.endDate) qs.end_date = formatDate(p.endDate);
        const data = (await apiRequest(ctx, ep.path, qs)) as Record<
          string,
          unknown
        >;
        let items = (data.data ?? []) as unknown[];
        if (p.limit) items = items.slice(0, p.limit as number);
        return items;
      },
    });
  }
}
