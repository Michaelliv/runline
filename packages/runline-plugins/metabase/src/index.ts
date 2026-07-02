import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  baseUrl: string,
  sessionToken: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: {
      "X-Metabase-Session": sessionToken,
      "Content-Type": "application/json",
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  )
    opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${endpoint}`, opts);
  if (!res.ok)
    throw new Error(`Metabase API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function metabase(rl: RunlinePluginAPI) {
  rl.setName("metabase");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "Metabase instance URL (e.g. https://metabase.example.com)",
      env: "METABASE_URL",
    },
    sessionToken: {
      type: "string",
      required: true,
      description: "Metabase session token (from POST /api/session)",
      env: "METABASE_SESSION_TOKEN",
    },
  });

  const conn = (ctx: { connection: { config: Record<string, unknown> } }) => ({
    baseUrl: (ctx.connection.config.url as string).replace(/\/$/, ""),
    token: ctx.connection.config.sessionToken as string,
  });

  // ── Question (Card) ─────────────────────────────────

  rl.registerAction("question.get", {
    access: "read",
    description: "Get a specific question/card",
    inputSchema: { questionId: { type: "number", required: true } },
    async execute(input, ctx) {
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "GET",
        `/api/card/${(input as { questionId: number }).questionId}`,
      );
    },
  });

  rl.registerAction("question.list", {
    access: "read",
    description: "List all questions/cards",
    async execute(_input, ctx) {
      const { baseUrl, token } = conn(ctx);
      return apiRequest(baseUrl, token, "GET", "/api/card/");
    },
  });

  rl.registerAction("question.getResults", {
    access: "read",
    description: "Get the results of a question as JSON",
    inputSchema: {
      questionId: { type: "number", required: true },
      format: {
        type: "string",
        required: false,
        description:
          "json (default), csv, xlsx — note: only json returns structured data",
      },
    },
    async execute(input, ctx) {
      const { questionId, format = "json" } = input as Record<string, unknown>;
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "POST",
        `/api/card/${questionId}/query/${format}`,
      );
    },
  });

  // ── Alert ───────────────────────────────────────────

  rl.registerAction("alert.get", {
    access: "read",
    description: "Get a specific alert",
    inputSchema: { alertId: { type: "number", required: true } },
    async execute(input, ctx) {
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "GET",
        `/api/alert/${(input as { alertId: number }).alertId}`,
      );
    },
  });

  rl.registerAction("alert.list", {
    access: "read",
    description: "List all alerts",
    async execute(_input, ctx) {
      const { baseUrl, token } = conn(ctx);
      return apiRequest(baseUrl, token, "GET", "/api/alert/");
    },
  });

  // ── Database ────────────────────────────────────────

  rl.registerAction("database.list", {
    access: "read",
    description: "List all databases",
    async execute(_input, ctx) {
      const { baseUrl, token } = conn(ctx);
      const data = (await apiRequest(
        baseUrl,
        token,
        "GET",
        "/api/database/",
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("database.getFields", {
    access: "read",
    description: "Get fields from a database",
    inputSchema: { databaseId: { type: "number", required: true } },
    async execute(input, ctx) {
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "GET",
        `/api/database/${(input as { databaseId: number }).databaseId}/fields`,
      );
    },
  });

  rl.registerAction("database.add", {
    access: "write",
    description: "Add a new database/datasource",
    inputSchema: {
      name: { type: "string", required: true, description: "Display name" },
      engine: {
        type: "string",
        required: true,
        description: "postgres, mysql, h2, sqlite, mongo, redshift",
      },
      host: {
        type: "string",
        required: false,
        description: "Database host (for postgres/mysql/mongo/redshift)",
      },
      port: { type: "number", required: false, description: "Database port" },
      user: { type: "string", required: false, description: "Database user" },
      password: {
        type: "string",
        required: false,
        description: "Database password",
      },
      dbName: {
        type: "string",
        required: false,
        description: "Database name or file path (for h2/sqlite)",
      },
      isFullSync: {
        type: "boolean",
        required: false,
        description: "Full sync (default true)",
      },
    },
    async execute(input, ctx) {
      const {
        name,
        engine,
        host,
        port,
        user,
        password,
        dbName,
        isFullSync = true,
      } = input as Record<string, unknown>;
      const { baseUrl, token } = conn(ctx);
      const details: Record<string, unknown> = {};
      if (host) details.host = host;
      if (port) details.port = port;
      if (user) details.user = user;
      if (password) details.password = password;
      if (dbName) details.db = dbName;
      return apiRequest(baseUrl, token, "POST", "/api/database", {
        name,
        engine,
        details,
        is_full_sync: isFullSync,
      });
    },
  });

  // ── Metric ──────────────────────────────────────────

  rl.registerAction("metric.get", {
    access: "read",
    description: "Get a specific metric",
    inputSchema: { metricId: { type: "number", required: true } },
    async execute(input, ctx) {
      const { baseUrl, token } = conn(ctx);
      return apiRequest(
        baseUrl,
        token,
        "GET",
        `/api/metric/${(input as { metricId: number }).metricId}`,
      );
    },
  });

  rl.registerAction("metric.list", {
    access: "read",
    description: "List all metrics",
    async execute(_input, ctx) {
      const { baseUrl, token } = conn(ctx);
      return apiRequest(baseUrl, token, "GET", "/api/metric/");
    },
  });
}
