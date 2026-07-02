import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  baseUrl: string,
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${baseUrl}/api${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  ) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok)
    throw new Error(`Grafana API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    baseUrl: (ctx.connection.config.baseUrl as string).replace(/\/$/, ""),
    apiKey: ctx.connection.config.apiKey as string,
  };
}

function gf(
  ctx: { connection: { config: Record<string, unknown> } },
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
) {
  const { baseUrl, apiKey } = getConn(ctx);
  return apiRequest(baseUrl, apiKey, method, endpoint, body, qs);
}

export default function grafana(rl: RunlinePluginAPI) {
  rl.setName("grafana");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    baseUrl: {
      type: "string",
      required: true,
      description: "Grafana base URL (e.g. https://grafana.example.com)",
      env: "GRAFANA_URL",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "Grafana API key or service account token",
      env: "GRAFANA_API_KEY",
    },
  });

  // ── Dashboard ───────────────────────────────────────

  rl.registerAction("dashboard.create", {
    access: "write",
    description: "Create or save a dashboard",
    inputSchema: {
      dashboard: {
        type: "object",
        required: true,
        description: "Dashboard JSON model",
      },
      folderId: { type: "number", required: false, description: "Folder ID" },
      overwrite: {
        type: "boolean",
        required: false,
        description: "Overwrite existing",
      },
      message: { type: "string", required: false, description: "Save message" },
    },
    async execute(input, ctx) {
      const { dashboard, folderId, overwrite, message } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { dashboard };
      if (folderId !== undefined) body.folderId = folderId;
      if (overwrite !== undefined) body.overwrite = overwrite;
      if (message) body.message = message;
      return gf(ctx, "POST", "/dashboards/db", body);
    },
  });

  rl.registerAction("dashboard.get", {
    access: "read",
    description: "Get a dashboard by UID",
    inputSchema: {
      uid: { type: "string", required: true, description: "Dashboard UID" },
    },
    async execute(input, ctx) {
      return gf(
        ctx,
        "GET",
        `/dashboards/uid/${(input as { uid: string }).uid}`,
      );
    },
  });

  rl.registerAction("dashboard.list", {
    access: "read",
    description: "Search dashboards",
    inputSchema: {
      query: { type: "string", required: false, description: "Search query" },
      tag: { type: "string", required: false, description: "Filter by tag" },
      type: {
        type: "string",
        required: false,
        description: "dash-db or dash-folder",
      },
      folderId: {
        type: "number",
        required: false,
        description: "Filter by folder ID",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { query, tag, type, folderId, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (query) qs.query = query;
      if (tag) qs.tag = tag;
      if (type) qs.type = type;
      if (folderId !== undefined) qs.folderIds = folderId;
      if (limit) qs.limit = limit;
      return gf(ctx, "GET", "/search", undefined, qs);
    },
  });

  rl.registerAction("dashboard.delete", {
    access: "write",
    description: "Delete a dashboard by UID",
    inputSchema: {
      uid: { type: "string", required: true, description: "Dashboard UID" },
    },
    async execute(input, ctx) {
      return gf(
        ctx,
        "DELETE",
        `/dashboards/uid/${(input as { uid: string }).uid}`,
      );
    },
  });

  rl.registerAction("dashboard.update", {
    access: "write",
    description: "Update an existing dashboard",
    inputSchema: {
      uid: {
        type: "string",
        required: true,
        description: "Dashboard UID to update",
      },
      dashboard: {
        type: "object",
        required: true,
        description: "Updated dashboard JSON model",
      },
      folderId: { type: "number", required: false, description: "Folder ID" },
      message: { type: "string", required: false, description: "Save message" },
    },
    async execute(input, ctx) {
      const { uid, dashboard, folderId, message } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {
        dashboard: { ...(dashboard as Record<string, unknown>), uid },
        overwrite: true,
      };
      if (folderId !== undefined) body.folderId = folderId;
      if (message) body.message = message;
      return gf(ctx, "POST", "/dashboards/db", body);
    },
  });

  // ── Team ────────────────────────────────────────────

  rl.registerAction("team.create", {
    access: "write",
    description: "Create a team",
    inputSchema: {
      name: { type: "string", required: true, description: "Team name" },
      email: { type: "string", required: false, description: "Team email" },
    },
    async execute(input, ctx) {
      const { name, email } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name };
      if (email) body.email = email;
      return gf(ctx, "POST", "/teams", body);
    },
  });

  rl.registerAction("team.get", {
    access: "read",
    description: "Get a team by ID",
    inputSchema: {
      teamId: { type: "number", required: true, description: "Team ID" },
    },
    async execute(input, ctx) {
      return gf(ctx, "GET", `/teams/${(input as { teamId: number }).teamId}`);
    },
  });

  rl.registerAction("team.list", {
    access: "read",
    description: "Search teams",
    inputSchema: {
      query: { type: "string", required: false, description: "Search by name" },
      limit: { type: "number", required: false, description: "Max results" },
      page: { type: "number", required: false, description: "Page number" },
    },
    async execute(input, ctx) {
      const { query, limit, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (query) qs.query = query;
      if (limit) qs.perpage = limit;
      if (page) qs.page = page;
      const data = (await gf(
        ctx,
        "GET",
        "/teams/search",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.teams;
    },
  });

  rl.registerAction("team.update", {
    access: "write",
    description: "Update a team",
    inputSchema: {
      teamId: { type: "number", required: true, description: "Team ID" },
      name: { type: "string", required: false, description: "New name" },
      email: { type: "string", required: false, description: "New email" },
    },
    async execute(input, ctx) {
      const { teamId, name, email } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (email) body.email = email;
      return gf(ctx, "PUT", `/teams/${teamId}`, body);
    },
  });

  rl.registerAction("team.delete", {
    access: "write",
    description: "Delete a team",
    inputSchema: {
      teamId: { type: "number", required: true, description: "Team ID" },
    },
    async execute(input, ctx) {
      return gf(
        ctx,
        "DELETE",
        `/teams/${(input as { teamId: number }).teamId}`,
      );
    },
  });

  // ── Team Member ─────────────────────────────────────

  rl.registerAction("teamMember.add", {
    access: "write",
    description: "Add a user to a team",
    inputSchema: {
      teamId: { type: "number", required: true, description: "Team ID" },
      userId: { type: "number", required: true, description: "User ID to add" },
    },
    async execute(input, ctx) {
      const { teamId, userId } = input as { teamId: number; userId: number };
      return gf(ctx, "POST", `/teams/${teamId}/members`, { userId });
    },
  });

  rl.registerAction("teamMember.remove", {
    access: "write",
    description: "Remove a user from a team",
    inputSchema: {
      teamId: { type: "number", required: true, description: "Team ID" },
      userId: {
        type: "number",
        required: true,
        description: "User ID to remove",
      },
    },
    async execute(input, ctx) {
      const { teamId, userId } = input as { teamId: number; userId: number };
      return gf(ctx, "DELETE", `/teams/${teamId}/members/${userId}`);
    },
  });

  rl.registerAction("teamMember.list", {
    access: "read",
    description: "List members of a team",
    inputSchema: {
      teamId: { type: "number", required: true, description: "Team ID" },
    },
    async execute(input, ctx) {
      return gf(
        ctx,
        "GET",
        `/teams/${(input as { teamId: number }).teamId}/members`,
      );
    },
  });

  // ── User (Org) ──────────────────────────────────────

  rl.registerAction("user.create", {
    access: "write",
    description: "Add a user to the current organization",
    inputSchema: {
      loginOrEmail: {
        type: "string",
        required: true,
        description: "Login name or email",
      },
      role: {
        type: "string",
        required: true,
        description: "Viewer, Editor, or Admin",
      },
    },
    async execute(input, ctx) {
      const { loginOrEmail, role } = input as {
        loginOrEmail: string;
        role: string;
      };
      return gf(ctx, "POST", "/org/users", { loginOrEmail, role });
    },
  });

  rl.registerAction("user.list", {
    access: "read",
    description: "List users in the current organization",
    async execute(_input, ctx) {
      return gf(ctx, "GET", "/org/users");
    },
  });

  rl.registerAction("user.update", {
    access: "write",
    description: "Update a user's role in the organization",
    inputSchema: {
      userId: { type: "number", required: true, description: "User ID" },
      role: {
        type: "string",
        required: true,
        description: "Viewer, Editor, or Admin",
      },
    },
    async execute(input, ctx) {
      const { userId, role } = input as { userId: number; role: string };
      return gf(ctx, "PATCH", `/org/users/${userId}`, { role });
    },
  });

  rl.registerAction("user.delete", {
    access: "write",
    description: "Remove a user from the organization",
    inputSchema: {
      userId: { type: "number", required: true, description: "User ID" },
    },
    async execute(input, ctx) {
      return gf(
        ctx,
        "DELETE",
        `/org/users/${(input as { userId: number }).userId}`,
      );
    },
  });
}
