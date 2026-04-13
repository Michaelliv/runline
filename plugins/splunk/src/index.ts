import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const baseUrl = (ctx.connection.config.baseUrl as string).replace(/\/$/, "");
  const authToken = ctx.connection.config.authToken as string;
  return { baseUrl, authToken };
}

// Splunk REST API uses form-urlencoded for POST, returns JSON when output_mode=json
async function api(baseUrl: string, token: string, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${baseUrl}${endpoint}`);
  // Always request JSON output
  url.searchParams.set("output_mode", "json");
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const init: RequestInit = { method, headers };

  if (body && Object.keys(body).length > 0) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) { for (const item of v) params.append(k, String(item)); }
      else params.set(k, String(v));
    }
    init.body = params.toString();
  }

  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Splunk error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  if (!text) return { success: true };
  const json = JSON.parse(text);

  // Format entry array if present
  if (json.entry && Array.isArray(json.entry)) {
    return json.entry.map((e: Record<string, unknown>) => {
      const { content, link, ...rest } = e;
      const flat = { ...rest, ...(content as Record<string, unknown> ?? {}) };
      if (flat.id && typeof flat.id === "string") { flat.entryUrl = flat.id; flat.id = (flat.id as string).split("/").pop(); }
      return flat;
    });
  }
  return json;
}

export default function splunk(rl: RunlinePluginAPI) {
  rl.setName("splunk");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    baseUrl: { type: "string", required: true, description: "Splunk instance URL, e.g. https://localhost:8089", env: "SPLUNK_BASE_URL" },
    authToken: { type: "string", required: true, description: "Splunk auth token", env: "SPLUNK_AUTH_TOKEN" },
  });

  // ── Search Jobs ─────────────────────────────────────

  rl.registerAction("search.create", { description: "Create a search job",
    inputSchema: { search: { type: "string", required: true, description: "SPL query" }, execMode: { type: "string", required: false, description: "blocking, normal, or oneshot" }, earliestTime: { type: "string", required: false }, latestTime: { type: "string", required: false }, maxTime: { type: "number", required: false }, namespace: { type: "string", required: false } },
    async execute(input, ctx) {
      const { baseUrl, authToken } = getConn(ctx);
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { search: p.search };
      if (p.execMode) body.exec_mode = p.execMode;
      if (p.earliestTime) body.earliest_time = p.earliestTime;
      if (p.latestTime) body.latest_time = p.latestTime;
      if (p.maxTime) body.max_time = p.maxTime;
      if (p.namespace) body.namespace = p.namespace;
      // Create returns XML with sid, then we fetch JSON
      const createRes = await api(baseUrl, authToken, "POST", "/services/search/jobs", body) as Record<string, unknown>;
      const sid = createRes.sid as string | undefined;
      if (sid) return api(baseUrl, authToken, "GET", `/services/search/jobs/${sid}`);
      return createRes;
    } });

  rl.registerAction("search.get", { description: "Get a search job by ID",
    inputSchema: { searchJobId: { type: "string", required: true } },
    async execute(input, ctx) { const { baseUrl, authToken } = getConn(ctx); return api(baseUrl, authToken, "GET", `/services/search/jobs/${(input as Record<string, unknown>).searchJobId}`); } });

  rl.registerAction("search.list", { description: "List search jobs",
    inputSchema: { limit: { type: "number", required: false }, sortKey: { type: "string", required: false }, sortDir: { type: "string", required: false, description: "asc or desc" } },
    async execute(input, ctx) {
      const { baseUrl, authToken } = getConn(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.count = p.limit; else qs.count = 0;
      if (p.sortKey) qs.sort_key = p.sortKey;
      if (p.sortDir) qs.sort_dir = p.sortDir;
      return api(baseUrl, authToken, "GET", "/services/search/jobs", undefined, qs);
    } });

  rl.registerAction("search.delete", { description: "Delete a search job",
    inputSchema: { searchJobId: { type: "string", required: true } },
    async execute(input, ctx) { const { baseUrl, authToken } = getConn(ctx); await api(baseUrl, authToken, "DELETE", `/services/search/jobs/${(input as Record<string, unknown>).searchJobId}`); return { success: true }; } });

  rl.registerAction("search.getResults", { description: "Get results of a search job",
    inputSchema: { searchJobId: { type: "string", required: true }, limit: { type: "number", required: false }, filterKey: { type: "string", required: false, description: "Filter field name" }, filterValue: { type: "string", required: false, description: "Filter field value" } },
    async execute(input, ctx) {
      const { baseUrl, authToken } = getConn(ctx);
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.count = p.limit; else qs.count = 0;
      if (p.filterKey && p.filterValue) qs.search = `search ${p.filterKey}=${p.filterValue}`;
      return api(baseUrl, authToken, "GET", `/services/search/jobs/${p.searchJobId}/results`, undefined, qs);
    } });

  // ── Alerts ──────────────────────────────────────────

  rl.registerAction("alert.getMetrics", { description: "Get metric alerts", inputSchema: {},
    async execute(_input, ctx) { const { baseUrl, authToken } = getConn(ctx); return api(baseUrl, authToken, "GET", "/services/alerts/metric_alerts"); } });

  rl.registerAction("alert.getFired", { description: "Get fired alerts report", inputSchema: {},
    async execute(_input, ctx) { const { baseUrl, authToken } = getConn(ctx); return api(baseUrl, authToken, "GET", "/services/alerts/fired_alerts"); } });

  // ── Reports (Saved Searches) ────────────────────────

  rl.registerAction("report.create", { description: "Create a saved search / report from a search job",
    inputSchema: { name: { type: "string", required: true }, search: { type: "string", required: true, description: "SPL query for the report" }, cronSchedule: { type: "string", required: false }, earliestTime: { type: "string", required: false }, latestTime: { type: "string", required: false } },
    async execute(input, ctx) {
      const { baseUrl, authToken } = getConn(ctx);
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name, search: p.search, alert_type: "always" };
      if (p.cronSchedule) body.cron_schedule = p.cronSchedule;
      if (p.earliestTime) body["dispatch.earliest_time"] = p.earliestTime;
      if (p.latestTime) body["dispatch.latest_time"] = p.latestTime;
      return api(baseUrl, authToken, "POST", "/services/saved/searches", body);
    } });

  rl.registerAction("report.get", { description: "Get a saved search / report",
    inputSchema: { reportId: { type: "string", required: true } },
    async execute(input, ctx) { const { baseUrl, authToken } = getConn(ctx); return api(baseUrl, authToken, "GET", `/services/saved/searches/${(input as Record<string, unknown>).reportId}`); } });

  rl.registerAction("report.list", { description: "List saved searches / reports",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const { baseUrl, authToken } = getConn(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.count = p.limit; else qs.count = 0;
      return api(baseUrl, authToken, "GET", "/services/saved/searches", undefined, qs);
    } });

  rl.registerAction("report.delete", { description: "Delete a saved search / report",
    inputSchema: { reportId: { type: "string", required: true } },
    async execute(input, ctx) { const { baseUrl, authToken } = getConn(ctx); await api(baseUrl, authToken, "DELETE", `/services/saved/searches/${(input as Record<string, unknown>).reportId}`); return { success: true }; } });

  // ── Users ───────────────────────────────────────────

  rl.registerAction("user.create", { description: "Create a Splunk user",
    inputSchema: { name: { type: "string", required: true, description: "Login name" }, password: { type: "string", required: true }, roles: { type: "object", required: true, description: "Array of role names" }, email: { type: "string", required: false }, realname: { type: "string", required: false, description: "Full name" } },
    async execute(input, ctx) {
      const { baseUrl, authToken } = getConn(ctx);
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name, password: p.password, roles: p.roles };
      if (p.email) body.email = p.email;
      if (p.realname) body.realname = p.realname;
      return api(baseUrl, authToken, "POST", "/services/authentication/users", body);
    } });

  rl.registerAction("user.get", { description: "Get a user",
    inputSchema: { userId: { type: "string", required: true, description: "Username" } },
    async execute(input, ctx) { const { baseUrl, authToken } = getConn(ctx); return api(baseUrl, authToken, "GET", `/services/authentication/users/${(input as Record<string, unknown>).userId}`); } });

  rl.registerAction("user.list", { description: "List users",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const { baseUrl, authToken } = getConn(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.count = p.limit; else qs.count = 0;
      return api(baseUrl, authToken, "GET", "/services/authentication/users", undefined, qs);
    } });

  rl.registerAction("user.update", { description: "Update a user",
    inputSchema: { userId: { type: "string", required: true, description: "Username" }, email: { type: "string", required: false }, realname: { type: "string", required: false }, password: { type: "string", required: false }, roles: { type: "object", required: false, description: "Array of role names" } },
    async execute(input, ctx) {
      const { baseUrl, authToken } = getConn(ctx);
      const { userId, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.email) body.email = fields.email;
      if (fields.realname) body.realname = fields.realname;
      if (fields.password) body.password = fields.password;
      if (fields.roles) body.roles = fields.roles;
      return api(baseUrl, authToken, "POST", `/services/authentication/users/${userId}`, body);
    } });

  rl.registerAction("user.delete", { description: "Delete a user",
    inputSchema: { userId: { type: "string", required: true, description: "Username" } },
    async execute(input, ctx) { const { baseUrl, authToken } = getConn(ctx); await api(baseUrl, authToken, "DELETE", `/services/authentication/users/${(input as Record<string, unknown>).userId}`); return { success: true }; } });
}
