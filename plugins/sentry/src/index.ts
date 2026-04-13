import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  const base = ((c.url as string | undefined) ?? "https://sentry.io").replace(/\/$/, "");
  return { base, token: c.token as string };
}

async function apiRequest(
  conn: { base: string; token: string }, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${conn.base}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${conn.token}`, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Sentry error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

type Ctx = { connection: { config: Record<string, unknown> } };

function registerCrud(
  rl: RunlinePluginAPI, resource: string, basePath: (p: Record<string, unknown>) => string,
  idField: string, extraCreateFields?: Record<string, { type: string; required: boolean; description?: string }>,
) {
  rl.registerAction(`${resource}.get`, {
    description: `Get a ${resource} by ${idField}`,
    inputSchema: { [idField]: { type: "string", required: true }, org: { type: "string", required: true, description: "Organization slug" } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx as Ctx), "GET", `${basePath(p)}${p[idField]}/`);
    },
  });

  rl.registerAction(`${resource}.list`, {
    description: `List ${resource}s`,
    inputSchema: { org: { type: "string", required: true }, limit: { type: "number", required: false }, ...(resource === "event" || resource === "issue" ? { project: { type: "string", required: true, description: "Project slug" } } : {}) },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      const data = (await apiRequest(getConn(ctx as Ctx), "GET", basePath(p), undefined, qs)) as unknown[];
      return data;
    },
  });

  rl.registerAction(`${resource}.delete`, {
    description: `Delete a ${resource}`,
    inputSchema: { [idField]: { type: "string", required: true }, org: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await apiRequest(getConn(ctx as Ctx), "DELETE", `${basePath(p)}${p[idField]}/`);
      return { success: true };
    },
  });
}

export default function sentry(rl: RunlinePluginAPI) {
  rl.setName("sentry");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    token: { type: "string", required: true, description: "Sentry auth token (Bearer)", env: "SENTRY_TOKEN" },
    url: { type: "string", required: false, description: "Sentry base URL (default https://sentry.io)", env: "SENTRY_URL" },
  });

  // ── Event ───────────────────────────────────────────

  rl.registerAction("event.get", {
    description: "Get a project event by ID",
    inputSchema: { org: { type: "string", required: true }, project: { type: "string", required: true }, eventId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "GET", `/api/0/projects/${p.org}/${p.project}/events/${p.eventId}/`);
    },
  });

  rl.registerAction("event.list", {
    description: "List project events",
    inputSchema: { org: { type: "string", required: true }, project: { type: "string", required: true }, full: { type: "boolean", required: false }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.full) qs.full = "true";
      if (p.limit) qs.limit = p.limit;
      return apiRequest(getConn(ctx), "GET", `/api/0/projects/${p.org}/${p.project}/events/`, undefined, qs);
    },
  });

  // ── Issue ───────────────────────────────────────────

  rl.registerAction("issue.get", {
    description: "Get an issue by ID",
    inputSchema: { issueId: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "GET", `/api/0/issues/${(input as Record<string, unknown>).issueId}/`); },
  });

  rl.registerAction("issue.list", {
    description: "List issues for a project",
    inputSchema: { org: { type: "string", required: true }, project: { type: "string", required: true }, query: { type: "string", required: false }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.query) qs.query = p.query;
      if (p.limit) qs.limit = p.limit;
      return apiRequest(getConn(ctx), "GET", `/api/0/projects/${p.org}/${p.project}/issues/`, undefined, qs);
    },
  });

  rl.registerAction("issue.update", {
    description: "Update an issue",
    inputSchema: { issueId: { type: "string", required: true }, status: { type: "string", required: false }, assignedTo: { type: "string", required: false }, hasSeen: { type: "boolean", required: false }, isBookmarked: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const { issueId, ...fields } = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "PUT", `/api/0/issues/${issueId}/`, fields);
    },
  });

  rl.registerAction("issue.delete", {
    description: "Delete an issue",
    inputSchema: { issueId: { type: "string", required: true } },
    async execute(input, ctx) { await apiRequest(getConn(ctx), "DELETE", `/api/0/issues/${(input as Record<string, unknown>).issueId}/`); return { success: true }; },
  });

  // ── Organization ────────────────────────────────────

  rl.registerAction("organization.get", {
    description: "Get an organization",
    inputSchema: { org: { type: "string", required: true } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "GET", `/api/0/organizations/${(input as Record<string, unknown>).org}/`); },
  });

  rl.registerAction("organization.list", {
    description: "List organizations",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit) qs.limit = (input as Record<string, unknown>).limit;
      return apiRequest(getConn(ctx), "GET", "/api/0/organizations/", undefined, qs);
    },
  });

  rl.registerAction("organization.create", {
    description: "Create an organization",
    inputSchema: { name: { type: "string", required: true }, slug: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(getConn(ctx), "POST", "/api/0/organizations/", { name: p.name, agreeTerms: true, slug: p.slug });
    },
  });

  // ── Project ─────────────────────────────────────────

  rl.registerAction("project.get", {
    description: "Get a project",
    inputSchema: { org: { type: "string", required: true }, project: { type: "string", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return apiRequest(getConn(ctx), "GET", `/api/0/projects/${p.org}/${p.project}/`); },
  });

  rl.registerAction("project.list", {
    description: "List all projects",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) { return apiRequest(getConn(ctx), "GET", "/api/0/projects/", undefined, (input as Record<string, unknown>)?.limit ? { limit: (input as Record<string, unknown>).limit } : undefined); },
  });

  rl.registerAction("project.create", {
    description: "Create a project",
    inputSchema: { org: { type: "string", required: true }, team: { type: "string", required: true }, name: { type: "string", required: true }, slug: { type: "string", required: false }, platform: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name };
      if (p.slug) body.slug = p.slug;
      if (p.platform) body.platform = p.platform;
      return apiRequest(getConn(ctx), "POST", `/api/0/teams/${p.org}/${p.team}/projects/`, body);
    },
  });

  rl.registerAction("project.delete", {
    description: "Delete a project",
    inputSchema: { org: { type: "string", required: true }, project: { type: "string", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; await apiRequest(getConn(ctx), "DELETE", `/api/0/projects/${p.org}/${p.project}/`); return { success: true }; },
  });

  // ── Release ─────────────────────────────────────────

  rl.registerAction("release.get", {
    description: "Get a release",
    inputSchema: { org: { type: "string", required: true }, version: { type: "string", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return apiRequest(getConn(ctx), "GET", `/api/0/organizations/${p.org}/releases/${encodeURIComponent(p.version as string)}/`); },
  });

  rl.registerAction("release.list", {
    description: "List releases",
    inputSchema: { org: { type: "string", required: true }, query: { type: "string", required: false }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.query) qs.query = p.query;
      if (p.limit) qs.limit = p.limit;
      return apiRequest(getConn(ctx), "GET", `/api/0/organizations/${p.org}/releases/`, undefined, qs);
    },
  });

  rl.registerAction("release.create", {
    description: "Create a release",
    inputSchema: { org: { type: "string", required: true }, version: { type: "string", required: true }, projects: { type: "object", required: true, description: "Array of project slugs" }, url: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { version: p.version, projects: p.projects };
      if (p.url) body.url = p.url;
      return apiRequest(getConn(ctx), "POST", `/api/0/organizations/${p.org}/releases/`, body);
    },
  });

  rl.registerAction("release.delete", {
    description: "Delete a release",
    inputSchema: { org: { type: "string", required: true }, version: { type: "string", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; await apiRequest(getConn(ctx), "DELETE", `/api/0/organizations/${p.org}/releases/${encodeURIComponent(p.version as string)}/`); return { success: true }; },
  });

  // ── Team ────────────────────────────────────────────

  rl.registerAction("team.get", {
    description: "Get a team",
    inputSchema: { org: { type: "string", required: true }, team: { type: "string", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return apiRequest(getConn(ctx), "GET", `/api/0/teams/${p.org}/${p.team}/`); },
  });

  rl.registerAction("team.list", {
    description: "List teams in an organization",
    inputSchema: { org: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return apiRequest(getConn(ctx), "GET", `/api/0/organizations/${p.org}/teams/`, undefined, p.limit ? { limit: p.limit } : undefined);
    },
  });

  rl.registerAction("team.create", {
    description: "Create a team",
    inputSchema: { org: { type: "string", required: true }, name: { type: "string", required: true }, slug: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name };
      if (p.slug) body.slug = p.slug;
      return apiRequest(getConn(ctx), "POST", `/api/0/organizations/${p.org}/teams/`, body);
    },
  });

  rl.registerAction("team.delete", {
    description: "Delete a team",
    inputSchema: { org: { type: "string", required: true }, team: { type: "string", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; await apiRequest(getConn(ctx), "DELETE", `/api/0/teams/${p.org}/${p.team}/`); return { success: true }; },
  });
}
