import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { sentryCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

async function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, sentryCredential, "sentry", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

function registerCrud(
  rl: RunlinePluginAPI,
  resource: string,
  basePath: (p: Record<string, unknown>) => string,
  idField: string,
  extraCreateFields?: Record<
    string,
    { type: string; required: boolean; description?: string }
  >,
) {
  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource} by ${idField}`,
    inputSchema: {
      [idField]: { type: "string", required: true },
      org: { type: "string", required: true, description: "Organization slug" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(ctx, "GET", `${basePath(p)}${seg(p[idField])}/`);
    },
  });

  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `List ${resource}s`,
    inputSchema: {
      org: { type: "string", required: true },
      limit: { type: "number", required: false },
      ...(resource === "event" || resource === "issue"
        ? {
            project: {
              type: "string",
              required: true,
              description: "Project slug",
            },
          }
        : {}),
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      const data = (await apiRequest(
        ctx,
        "GET",
        basePath(p),
        undefined,
        qs,
      )) as unknown[];
      return data;
    },
  });

  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: {
      [idField]: { type: "string", required: true },
      org: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await apiRequest(ctx, "DELETE", `${basePath(p)}${seg(p[idField])}/`);
      return { success: true };
    },
  });
}

export default function sentry(rl: RunlinePluginAPI) {
  rl.setName("sentry");
  rl.setVersion("0.1.0");
  rl.setCredential(sentryCredential);

  rl.setConnectionSchema({
    token: {
      type: "string",
      required: true,
      description: "Sentry auth token (Bearer)",
      env: "SENTRY_TOKEN",
    },
    url: {
      type: "string",
      required: false,
      description: "Sentry base URL (default https://sentry.io)",
      env: "SENTRY_URL",
    },
  });

  // ── Event ───────────────────────────────────────────

  rl.registerAction("event.get", {
    access: "read",
    description: "Get a project event by ID",
    inputSchema: {
      org: { type: "string", required: true },
      project: { type: "string", required: true },
      eventId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `projects/${seg(p.org)}/${seg(p.project)}/events/${seg(p.eventId)}/`,
      );
    },
  });

  rl.registerAction("event.list", {
    access: "read",
    description: "List project events",
    inputSchema: {
      org: { type: "string", required: true },
      project: { type: "string", required: true },
      full: { type: "boolean", required: false },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.full) qs.full = "true";
      if (p.limit) qs.limit = p.limit;
      return apiRequest(
        ctx,
        "GET",
        `projects/${seg(p.org)}/${seg(p.project)}/events/`,
        undefined,
        qs,
      );
    },
  });

  // ── Issue ───────────────────────────────────────────

  rl.registerAction("issue.get", {
    access: "read",
    description: "Get an issue by ID",
    inputSchema: { issueId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `issues/${seg((input as Record<string, unknown>).issueId)}/`,
      );
    },
  });

  rl.registerAction("issue.list", {
    access: "read",
    description: "List issues for a project",
    inputSchema: {
      org: { type: "string", required: true },
      project: { type: "string", required: true },
      query: { type: "string", required: false },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.query) qs.query = p.query;
      if (p.limit) qs.limit = p.limit;
      return apiRequest(
        ctx,
        "GET",
        `projects/${seg(p.org)}/${seg(p.project)}/issues/`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("issue.update", {
    access: "write",
    description: "Update an issue",
    inputSchema: {
      issueId: { type: "string", required: true },
      status: { type: "string", required: false },
      assignedTo: { type: "string", required: false },
      hasSeen: { type: "boolean", required: false },
      isBookmarked: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const { issueId, ...fields } = input as Record<string, unknown>;
      return apiRequest(ctx, "PUT", `issues/${seg(issueId)}/`, fields);
    },
  });

  rl.registerAction("issue.delete", {
    access: "write",
    description: "Delete an issue",
    inputSchema: { issueId: { type: "string", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `issues/${seg((input as Record<string, unknown>).issueId)}/`,
      );
      return { success: true };
    },
  });

  // ── Organization ────────────────────────────────────

  rl.registerAction("organization.get", {
    access: "read",
    description: "Get an organization",
    inputSchema: { org: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `organizations/${seg((input as Record<string, unknown>).org)}/`,
      );
    },
  });

  rl.registerAction("organization.list", {
    access: "read",
    description: "List organizations",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit)
        qs.limit = (input as Record<string, unknown>).limit;
      return apiRequest(ctx, "GET", "organizations/", undefined, qs);
    },
  });

  rl.registerAction("organization.create", {
    access: "write",
    description: "Create an organization",
    inputSchema: {
      name: { type: "string", required: true },
      slug: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", "organizations/", {
        name: p.name,
        agreeTerms: true,
        slug: p.slug,
      });
    },
  });

  // ── Project ─────────────────────────────────────────

  rl.registerAction("project.get", {
    access: "read",
    description: "Get a project",
    inputSchema: {
      org: { type: "string", required: true },
      project: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `projects/${seg(p.org)}/${seg(p.project)}/`,
      );
    },
  });

  rl.registerAction("project.list", {
    access: "read",
    description: "List all projects",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        "projects/",
        undefined,
        (input as Record<string, unknown>)?.limit
          ? { limit: (input as Record<string, unknown>).limit }
          : undefined,
      );
    },
  });

  rl.registerAction("project.create", {
    access: "write",
    description: "Create a project",
    inputSchema: {
      org: { type: "string", required: true },
      team: { type: "string", required: true },
      name: { type: "string", required: true },
      slug: { type: "string", required: false },
      platform: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name };
      if (p.slug) body.slug = p.slug;
      if (p.platform) body.platform = p.platform;
      return apiRequest(
        ctx,
        "POST",
        `teams/${seg(p.org)}/${seg(p.team)}/projects/`,
        body,
      );
    },
  });

  rl.registerAction("project.delete", {
    access: "write",
    description: "Delete a project",
    inputSchema: {
      org: { type: "string", required: true },
      project: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await apiRequest(
        ctx,
        "DELETE",
        `projects/${seg(p.org)}/${seg(p.project)}/`,
      );
      return { success: true };
    },
  });

  // ── Release ─────────────────────────────────────────

  rl.registerAction("release.get", {
    access: "read",
    description: "Get a release",
    inputSchema: {
      org: { type: "string", required: true },
      version: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `organizations/${seg(p.org)}/releases/${encodeURIComponent(p.version as string)}/`,
      );
    },
  });

  rl.registerAction("release.list", {
    access: "read",
    description: "List releases",
    inputSchema: {
      org: { type: "string", required: true },
      query: { type: "string", required: false },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.query) qs.query = p.query;
      if (p.limit) qs.limit = p.limit;
      return apiRequest(
        ctx,
        "GET",
        `organizations/${seg(p.org)}/releases/`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("release.create", {
    access: "write",
    description: "Create a release",
    inputSchema: {
      org: { type: "string", required: true },
      version: { type: "string", required: true },
      projects: {
        type: "object",
        required: true,
        description: "Array of project slugs",
      },
      url: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        version: p.version,
        projects: p.projects,
      };
      if (p.url) body.url = p.url;
      return apiRequest(
        ctx,
        "POST",
        `organizations/${seg(p.org)}/releases/`,
        body,
      );
    },
  });

  rl.registerAction("release.delete", {
    access: "write",
    description: "Delete a release",
    inputSchema: {
      org: { type: "string", required: true },
      version: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await apiRequest(
        ctx,
        "DELETE",
        `organizations/${seg(p.org)}/releases/${encodeURIComponent(p.version as string)}/`,
      );
      return { success: true };
    },
  });

  // ── Team ────────────────────────────────────────────

  rl.registerAction("team.get", {
    access: "read",
    description: "Get a team",
    inputSchema: {
      org: { type: "string", required: true },
      team: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(ctx, "GET", `teams/${seg(p.org)}/${seg(p.team)}/`);
    },
  });

  rl.registerAction("team.list", {
    access: "read",
    description: "List teams in an organization",
    inputSchema: {
      org: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `organizations/${seg(p.org)}/teams/`,
        undefined,
        p.limit ? { limit: p.limit } : undefined,
      );
    },
  });

  rl.registerAction("team.create", {
    access: "write",
    description: "Create a team",
    inputSchema: {
      org: { type: "string", required: true },
      name: { type: "string", required: true },
      slug: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: p.name };
      if (p.slug) body.slug = p.slug;
      return apiRequest(
        ctx,
        "POST",
        `organizations/${seg(p.org)}/teams/`,
        body,
      );
    },
  });

  rl.registerAction("team.delete", {
    access: "write",
    description: "Delete a team",
    inputSchema: {
      org: { type: "string", required: true },
      team: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await apiRequest(ctx, "DELETE", `teams/${seg(p.org)}/${seg(p.team)}/`);
      return { success: true };
    },
  });
}
