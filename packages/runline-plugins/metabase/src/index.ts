import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { metabaseCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, metabaseCredential, "metabase", {
    target: "api",
    path: endpoint,
    method,
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: body }
      : {}),
  });
}

export default function metabase(rl: RunlinePluginAPI) {
  rl.setName("metabase");
  rl.setVersion("0.1.0");
  rl.setCredential(metabaseCredential);

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

  // ── Question (Card) ─────────────────────────────────

  rl.registerAction("question.get", {
    access: "read",
    description: "Get a specific question/card",
    inputSchema: { questionId: { type: "number", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `card/${pathSegment((input as { questionId: number }).questionId)}`,
      );
    },
  });

  rl.registerAction("question.list", {
    access: "read",
    description: "List all questions/cards",
    async execute(_input, ctx) {
      return apiRequest(ctx, "GET", "card/");
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
      return apiRequest(
        ctx,
        "POST",
        `card/${pathSegment(questionId)}/query/${pathSegment(format)}`,
      );
    },
  });

  // ── Alert ───────────────────────────────────────────

  rl.registerAction("alert.get", {
    access: "read",
    description: "Get a specific alert",
    inputSchema: { alertId: { type: "number", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `alert/${pathSegment((input as { alertId: number }).alertId)}`,
      );
    },
  });

  rl.registerAction("alert.list", {
    access: "read",
    description: "List all alerts",
    async execute(_input, ctx) {
      return apiRequest(ctx, "GET", "alert/");
    },
  });

  // ── Database ────────────────────────────────────────

  rl.registerAction("database.list", {
    access: "read",
    description: "List all databases",
    async execute(_input, ctx) {
      const data = (await apiRequest(ctx, "GET", "database/")) as Record<
        string,
        unknown
      >;
      return data.data;
    },
  });

  rl.registerAction("database.getFields", {
    access: "read",
    description: "Get fields from a database",
    inputSchema: { databaseId: { type: "number", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `database/${pathSegment((input as { databaseId: number }).databaseId)}/fields`,
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
      const details: Record<string, unknown> = {};
      if (host) details.host = host;
      if (port) details.port = port;
      if (user) details.user = user;
      if (password) details.password = password;
      if (dbName) details.db = dbName;
      return apiRequest(ctx, "POST", "database", {
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
      return apiRequest(
        ctx,
        "GET",
        `metric/${pathSegment((input as { metricId: number }).metricId)}`,
      );
    },
  });

  rl.registerAction("metric.list", {
    access: "read",
    description: "List all metrics",
    async execute(_input, ctx) {
      return apiRequest(ctx, "GET", "metric/");
    },
  });
}
