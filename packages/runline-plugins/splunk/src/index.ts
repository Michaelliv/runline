import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { splunkCredential } from "./credentials.js";

// The Splunk REST API takes form-urlencoded POST bodies and answers JSON
// because every request carries output_mode=json.
async function api(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const json = (await credentialJson(ctx, splunkCredential, "splunk", {
    target: "api",
    path,
    method,
    // JSON output always; callers never set output_mode themselves.
    query: { output_mode: "json", ...qs },
    ...(body && Object.keys(body).length > 0 ? { form: body } : {}),
  })) as Record<string, unknown>;

  // Format entry array if present
  if (json.entry && Array.isArray(json.entry)) {
    return json.entry.map((e: Record<string, unknown>) => {
      const { content, link, ...rest } = e;
      const flat = { ...rest, ...((content as Record<string, unknown>) ?? {}) };
      if (flat.id && typeof flat.id === "string") {
        flat.entryUrl = flat.id;
        flat.id = (flat.id as string).split("/").pop();
      }
      return flat;
    });
  }
  return json;
}

export default function splunk(rl: RunlinePluginAPI) {
  rl.setName("splunk");
  rl.setVersion("0.1.0");
  rl.setCredential(splunkCredential);
  rl.setConnectionSchema({
    baseUrl: {
      type: "string",
      required: true,
      description: "Splunk instance URL, e.g. https://localhost:8089",
      env: "SPLUNK_BASE_URL",
    },
    authToken: {
      type: "string",
      required: true,
      description: "Splunk auth token",
      env: "SPLUNK_AUTH_TOKEN",
    },
  });

  // ── Search Jobs ─────────────────────────────────────

  rl.registerAction("search.create", {
    access: "write",
    description: "Create a search job",
    inputSchema: {
      search: { type: "string", required: true, description: "SPL query" },
      execMode: {
        type: "string",
        required: false,
        description: "blocking, normal, or oneshot",
      },
      earliestTime: { type: "string", required: false },
      latestTime: { type: "string", required: false },
      maxTime: { type: "number", required: false },
      namespace: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { search: p.search };
      if (p.execMode) body.exec_mode = p.execMode;
      if (p.earliestTime) body.earliest_time = p.earliestTime;
      if (p.latestTime) body.latest_time = p.latestTime;
      if (p.maxTime) body.max_time = p.maxTime;
      if (p.namespace) body.namespace = p.namespace;
      // Create answers { sid }; the follow-up read returns the full job.
      const createRes = (await api(ctx, "POST", "search/jobs", body)) as Record<
        string,
        unknown
      >;
      const sid = createRes.sid as string | undefined;
      if (sid) return api(ctx, "GET", `search/jobs/${pathSegment(sid)}`);
      return createRes;
    },
  });

  rl.registerAction("search.get", {
    access: "read",
    description: "Get a search job by ID",
    inputSchema: { searchJobId: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `search/jobs/${pathSegment((input as Record<string, unknown>).searchJobId)}`,
      );
    },
  });

  rl.registerAction("search.list", {
    access: "read",
    description: "List search jobs",
    inputSchema: {
      limit: { type: "number", required: false },
      sortKey: { type: "string", required: false },
      sortDir: { type: "string", required: false, description: "asc or desc" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.count = p.limit;
      else qs.count = 0;
      if (p.sortKey) qs.sort_key = p.sortKey;
      if (p.sortDir) qs.sort_dir = p.sortDir;
      return api(ctx, "GET", "search/jobs", undefined, qs);
    },
  });

  rl.registerAction("search.delete", {
    access: "write",
    description: "Delete a search job",
    inputSchema: { searchJobId: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `search/jobs/${pathSegment((input as Record<string, unknown>).searchJobId)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("search.getResults", {
    access: "read",
    description: "Get results of a search job",
    inputSchema: {
      searchJobId: { type: "string", required: true },
      limit: { type: "number", required: false },
      filterKey: {
        type: "string",
        required: false,
        description: "Filter field name",
      },
      filterValue: {
        type: "string",
        required: false,
        description: "Filter field value",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.count = p.limit;
      else qs.count = 0;
      if (p.filterKey && p.filterValue)
        qs.search = `search ${p.filterKey}=${p.filterValue}`;
      return api(
        ctx,
        "GET",
        `search/jobs/${pathSegment(p.searchJobId)}/results`,
        undefined,
        qs,
      );
    },
  });

  // ── Alerts ──────────────────────────────────────────

  rl.registerAction("alert.getMetrics", {
    access: "read",
    description: "Get metric alerts",
    inputSchema: {},
    async execute(_input, ctx) {
      return api(ctx, "GET", "alerts/metric_alerts");
    },
  });

  rl.registerAction("alert.getFired", {
    access: "read",
    description: "Get fired alerts report",
    inputSchema: {},
    async execute(_input, ctx) {
      return api(ctx, "GET", "alerts/fired_alerts");
    },
  });

  // ── Reports (Saved Searches) ────────────────────────

  rl.registerAction("report.create", {
    access: "write",
    description: "Create a saved search / report from a search job",
    inputSchema: {
      name: { type: "string", required: true },
      search: {
        type: "string",
        required: true,
        description: "SPL query for the report",
      },
      cronSchedule: { type: "string", required: false },
      earliestTime: { type: "string", required: false },
      latestTime: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        name: p.name,
        search: p.search,
        alert_type: "always",
      };
      if (p.cronSchedule) body.cron_schedule = p.cronSchedule;
      if (p.earliestTime) body["dispatch.earliest_time"] = p.earliestTime;
      if (p.latestTime) body["dispatch.latest_time"] = p.latestTime;
      return api(ctx, "POST", "saved/searches", body);
    },
  });

  rl.registerAction("report.get", {
    access: "read",
    description: "Get a saved search / report",
    inputSchema: { reportId: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `saved/searches/${pathSegment((input as Record<string, unknown>).reportId)}`,
      );
    },
  });

  rl.registerAction("report.list", {
    access: "read",
    description: "List saved searches / reports",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.count = p.limit;
      else qs.count = 0;
      return api(ctx, "GET", "saved/searches", undefined, qs);
    },
  });

  rl.registerAction("report.delete", {
    access: "write",
    description: "Delete a saved search / report",
    inputSchema: { reportId: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `saved/searches/${pathSegment((input as Record<string, unknown>).reportId)}`,
      );
      return { success: true };
    },
  });

  // ── Users ───────────────────────────────────────────

  rl.registerAction("user.create", {
    access: "write",
    description: "Create a Splunk user",
    inputSchema: {
      name: { type: "string", required: true, description: "Login name" },
      password: { type: "string", required: true },
      roles: {
        type: "object",
        required: true,
        description: "Array of role names",
      },
      email: { type: "string", required: false },
      realname: { type: "string", required: false, description: "Full name" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        name: p.name,
        password: p.password,
        roles: p.roles,
      };
      if (p.email) body.email = p.email;
      if (p.realname) body.realname = p.realname;
      return api(ctx, "POST", "authentication/users", body);
    },
  });

  rl.registerAction("user.get", {
    access: "read",
    description: "Get a user",
    inputSchema: {
      userId: { type: "string", required: true, description: "Username" },
    },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `authentication/users/${pathSegment((input as Record<string, unknown>).userId)}`,
      );
    },
  });

  rl.registerAction("user.list", {
    access: "read",
    description: "List users",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.count = p.limit;
      else qs.count = 0;
      return api(ctx, "GET", "authentication/users", undefined, qs);
    },
  });

  rl.registerAction("user.update", {
    access: "write",
    description: "Update a user",
    inputSchema: {
      userId: { type: "string", required: true, description: "Username" },
      email: { type: "string", required: false },
      realname: { type: "string", required: false },
      password: { type: "string", required: false },
      roles: {
        type: "object",
        required: false,
        description: "Array of role names",
      },
    },
    async execute(input, ctx) {
      const { userId, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (fields.email) body.email = fields.email;
      if (fields.realname) body.realname = fields.realname;
      if (fields.password) body.password = fields.password;
      if (fields.roles) body.roles = fields.roles;
      return api(
        ctx,
        "POST",
        `authentication/users/${pathSegment(userId)}`,
        body,
      );
    },
  });

  rl.registerAction("user.delete", {
    access: "write",
    description: "Delete a user",
    inputSchema: {
      userId: { type: "string", required: true, description: "Username" },
    },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `authentication/users/${pathSegment((input as Record<string, unknown>).userId)}`,
      );
      return { success: true };
    },
  });
}
