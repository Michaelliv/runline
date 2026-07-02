import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.ouraring.com/v2";

async function apiRequest(
  token: string,
  endpoint: string,
  qs: Record<string, unknown> = {},
): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok)
    throw new Error(`Oura API error ${res.status}: ${await res.text()}`);
  return res.json();
}

function formatDate(d?: unknown): string | undefined {
  if (!d) return undefined;
  return String(d).split("T")[0];
}

export default function oura(rl: RunlinePluginAPI) {
  rl.setName("oura");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Oura personal access token",
      env: "OURA_ACCESS_TOKEN",
    },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.accessToken as string;

  rl.registerAction("profile.get", {
    access: "read",
    description: "Get the user's personal information",
    inputSchema: {},
    async execute(_input, ctx) {
      return apiRequest(key(ctx), "/usercollection/personal_info");
    },
  });

  const summaryEndpoints = [
    {
      name: "summary.activity",
      path: "/usercollection/daily_activity",
      description: "Get daily activity summary",
    },
    {
      name: "summary.readiness",
      path: "/usercollection/daily_readiness",
      description: "Get daily readiness summary",
    },
    {
      name: "summary.sleep",
      path: "/usercollection/daily_sleep",
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
        const data = (await apiRequest(key(ctx), ep.path, qs)) as Record<
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
