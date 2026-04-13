import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://www.beeminder.com/api/v1";

async function apiRequest(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.set("auth_token", token);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Beeminder API error ${res.status}: ${text}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return { success: true };
}

async function paginateAll(
  token: string,
  endpoint: string,
  qs?: Record<string, unknown>,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let page = 1;
  while (true) {
    const data = (await apiRequest(token, "GET", endpoint, undefined, { ...qs, page })) as unknown[];
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    page++;
  }
  return results;
}

function getToken(ctx: { connection: { config: Record<string, unknown> } }): string {
  return ctx.connection.config.apiToken as string;
}

export default function beeminder(rl: RunlinePluginAPI) {
  rl.setName("beeminder");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiToken: {
      type: "string",
      required: true,
      description: "Beeminder API token",
      env: "BEEMINDER_API_TOKEN",
    },
  });

  // ── Datapoint ───────────────────────────────────────

  rl.registerAction("datapoint.create", {
    description: "Create a datapoint for a goal",
    inputSchema: {
      goalName: { type: "string", required: true, description: "Goal slug" },
      value: { type: "number", required: true, description: "Datapoint value" },
      timestamp: { type: "number", required: false, description: "Unix timestamp (default: now)" },
      comment: { type: "string", required: false, description: "Comment" },
      requestid: { type: "string", required: false, description: "Unique ID to prevent duplicates" },
    },
    async execute(input, ctx) {
      const { goalName, ...body } = input as Record<string, unknown>;
      return apiRequest(getToken(ctx), "POST", `/users/me/goals/${goalName}/datapoints.json`, body);
    },
  });

  rl.registerAction("datapoint.createAll", {
    description: "Create multiple datapoints at once",
    inputSchema: {
      goalName: { type: "string", required: true, description: "Goal slug" },
      datapoints: { type: "array", required: true, description: "Array of {value, timestamp?, comment?, requestid?}" },
    },
    async execute(input, ctx) {
      const { goalName, datapoints } = input as { goalName: string; datapoints: unknown[] };
      return apiRequest(getToken(ctx), "POST", `/users/me/goals/${goalName}/datapoints/create_all.json`, { datapoints });
    },
  });

  rl.registerAction("datapoint.get", {
    description: "Get a single datapoint",
    inputSchema: {
      goalName: { type: "string", required: true, description: "Goal slug" },
      datapointId: { type: "string", required: true, description: "Datapoint ID" },
    },
    async execute(input, ctx) {
      const { goalName, datapointId } = input as { goalName: string; datapointId: string };
      return apiRequest(getToken(ctx), "GET", `/users/me/goals/${goalName}/datapoints/${datapointId}.json`);
    },
  });

  rl.registerAction("datapoint.list", {
    description: "List datapoints for a goal",
    inputSchema: {
      goalName: { type: "string", required: true, description: "Goal slug" },
      sort: { type: "string", required: false, description: "Sort attribute (default: id)" },
      limit: { type: "number", required: false, description: "Max results (omit for all)" },
      page: { type: "number", required: false, description: "Page number (1-indexed)" },
      per: { type: "number", required: false, description: "Results per page" },
    },
    async execute(input, ctx) {
      const { goalName, sort, limit, page, per } = (input ?? {}) as Record<string, unknown>;
      const token = getToken(ctx);
      const qs: Record<string, unknown> = {};
      if (sort) qs.sort = sort;

      if (limit) {
        qs.count = limit;
        if (page) qs.page = page;
        if (per) qs.per = per;
        return apiRequest(token, "GET", `/users/me/goals/${goalName}/datapoints.json`, undefined, qs);
      }
      return paginateAll(token, `/users/me/goals/${goalName}/datapoints.json`, qs);
    },
  });

  rl.registerAction("datapoint.update", {
    description: "Update a datapoint",
    inputSchema: {
      goalName: { type: "string", required: true, description: "Goal slug" },
      datapointId: { type: "string", required: true, description: "Datapoint ID" },
      value: { type: "number", required: false, description: "New value" },
      comment: { type: "string", required: false, description: "New comment" },
      timestamp: { type: "number", required: false, description: "New unix timestamp" },
    },
    async execute(input, ctx) {
      const { goalName, datapointId, ...body } = input as Record<string, unknown>;
      return apiRequest(getToken(ctx), "PUT", `/users/me/goals/${goalName}/datapoints/${datapointId}.json`, body);
    },
  });

  rl.registerAction("datapoint.delete", {
    description: "Delete a datapoint",
    inputSchema: {
      goalName: { type: "string", required: true, description: "Goal slug" },
      datapointId: { type: "string", required: true, description: "Datapoint ID" },
    },
    async execute(input, ctx) {
      const { goalName, datapointId } = input as { goalName: string; datapointId: string };
      return apiRequest(getToken(ctx), "DELETE", `/users/me/goals/${goalName}/datapoints/${datapointId}.json`);
    },
  });

  // ── Charge ──────────────────────────────────────────

  rl.registerAction("charge.create", {
    description: "Create a charge (pay money to Beeminder)",
    inputSchema: {
      amount: { type: "number", required: true, description: "Amount in USD" },
      note: { type: "string", required: false, description: "Charge explanation" },
      dryrun: { type: "boolean", required: false, description: "Test without actually charging" },
    },
    async execute(input, ctx) {
      const { amount, note, dryrun } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { user_id: "me", amount };
      if (note) body.note = note;
      if (dryrun) body.dryrun = dryrun;
      return apiRequest(getToken(ctx), "POST", "/charges.json", body);
    },
  });

  // ── Goal ────────────────────────────────────────────

  rl.registerAction("goal.create", {
    description: "Create a new goal",
    inputSchema: {
      slug: { type: "string", required: true, description: "Goal slug (unique identifier)" },
      title: { type: "string", required: true, description: "Human-readable title" },
      goal_type: { type: "string", required: true, description: "Goal type: hustler, biker, fatloser, gainer, inboxer, drinker, custom" },
      gunits: { type: "string", required: true, description: "Units (e.g. hours, pages, pounds)" },
      goaldate: { type: "number", required: false, description: "Target date (unix timestamp)" },
      goalval: { type: "number", required: false, description: "Target value" },
      rate: { type: "number", required: false, description: "Rate (units per day)" },
      initval: { type: "number", required: false, description: "Initial value (default: 0)" },
      secret: { type: "boolean", required: false, description: "Secret goal" },
      datapublic: { type: "boolean", required: false, description: "Public data" },
      datasource: { type: "string", required: false, description: "Data source: api, ifttt, zapier, manual" },
      dryrun: { type: "boolean", required: false, description: "Test without creating" },
      tags: { type: "array", required: false, description: "Array of tag strings" },
    },
    async execute(input, ctx) {
      return apiRequest(getToken(ctx), "POST", "/users/me/goals.json", input as Record<string, unknown>);
    },
  });

  rl.registerAction("goal.get", {
    description: "Get a specific goal",
    inputSchema: {
      goalName: { type: "string", required: true, description: "Goal slug" },
      datapoints: { type: "boolean", required: false, description: "Include datapoints" },
      emaciated: { type: "boolean", required: false, description: "Strip road/roadall/fullroad attributes" },
    },
    async execute(input, ctx) {
      const { goalName, ...qs } = input as Record<string, unknown>;
      return apiRequest(getToken(ctx), "GET", `/users/me/goals/${goalName}.json`, undefined, qs);
    },
  });

  rl.registerAction("goal.list", {
    description: "List all goals",
    inputSchema: {
      emaciated: { type: "boolean", required: false, description: "Strip road attributes" },
    },
    async execute(input, ctx) {
      const qs = (input ?? {}) as Record<string, unknown>;
      return apiRequest(getToken(ctx), "GET", "/users/me/goals.json", undefined, qs);
    },
  });

  rl.registerAction("goal.listArchived", {
    description: "List archived goals",
    inputSchema: {
      emaciated: { type: "boolean", required: false, description: "Strip road attributes" },
    },
    async execute(input, ctx) {
      const qs = (input ?? {}) as Record<string, unknown>;
      return apiRequest(getToken(ctx), "GET", "/users/me/goals/archived.json", undefined, qs);
    },
  });

  rl.registerAction("goal.update", {
    description: "Update a goal",
    inputSchema: {
      goalName: { type: "string", required: true, description: "Goal slug" },
      title: { type: "string", required: false, description: "New title" },
      yaxis: { type: "string", required: false, description: "Y-axis label" },
      tmin: { type: "string", required: false, description: "Min date (yyyy-mm-dd)" },
      tmax: { type: "string", required: false, description: "Max date (yyyy-mm-dd)" },
      secret: { type: "boolean", required: false, description: "Secret goal" },
      datapublic: { type: "boolean", required: false, description: "Public data" },
      roadall: { type: "array", required: false, description: "Road matrix [[date, value, rate], ...]" },
      datasource: { type: "string", required: false, description: "Data source" },
      tags: { type: "array", required: false, description: "Array of tag strings" },
    },
    async execute(input, ctx) {
      const { goalName, ...body } = input as Record<string, unknown>;
      return apiRequest(getToken(ctx), "PUT", `/users/me/goals/${goalName}.json`, body);
    },
  });

  rl.registerAction("goal.refresh", {
    description: "Refresh a goal's graph",
    inputSchema: {
      goalName: { type: "string", required: true, description: "Goal slug" },
    },
    async execute(input, ctx) {
      const { goalName } = input as { goalName: string };
      return apiRequest(getToken(ctx), "GET", `/users/me/goals/${goalName}/refresh_graph.json`);
    },
  });

  rl.registerAction("goal.shortCircuit", {
    description: "Short-circuit a goal's pledge",
    inputSchema: {
      goalName: { type: "string", required: true, description: "Goal slug" },
    },
    async execute(input, ctx) {
      const { goalName } = input as { goalName: string };
      return apiRequest(getToken(ctx), "POST", `/users/me/goals/${goalName}/shortcircuit.json`);
    },
  });

  rl.registerAction("goal.stepDown", {
    description: "Step down a goal's pledge",
    inputSchema: {
      goalName: { type: "string", required: true, description: "Goal slug" },
    },
    async execute(input, ctx) {
      const { goalName } = input as { goalName: string };
      return apiRequest(getToken(ctx), "POST", `/users/me/goals/${goalName}/stepdown.json`);
    },
  });

  rl.registerAction("goal.cancelStepDown", {
    description: "Cancel a step-down on a goal's pledge",
    inputSchema: {
      goalName: { type: "string", required: true, description: "Goal slug" },
    },
    async execute(input, ctx) {
      const { goalName } = input as { goalName: string };
      return apiRequest(getToken(ctx), "POST", `/users/me/goals/${goalName}/cancel_stepdown.json`);
    },
  });

  rl.registerAction("goal.uncle", {
    description: "Derail a goal and charge the pledge amount",
    inputSchema: {
      goalName: { type: "string", required: true, description: "Goal slug" },
    },
    async execute(input, ctx) {
      const { goalName } = input as { goalName: string };
      return apiRequest(getToken(ctx), "POST", `/users/me/goals/${goalName}/uncleme.json`);
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.get", {
    description: "Get current user information",
    inputSchema: {
      associations: { type: "boolean", required: false, description: "Include associations" },
      diff_since: { type: "number", required: false, description: "Unix timestamp — only return goals/datapoints changed since" },
      skinny: { type: "boolean", required: false, description: "Minimal user data" },
      emaciated: { type: "boolean", required: false, description: "Strip road attributes from goals" },
      datapoints_count: { type: "number", required: false, description: "Number of datapoints to include" },
    },
    async execute(input, ctx) {
      const qs = (input ?? {}) as Record<string, unknown>;
      return apiRequest(getToken(ctx), "GET", "/users/me.json", undefined, qs);
    },
  });
}
