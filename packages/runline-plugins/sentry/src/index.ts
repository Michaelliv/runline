import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { sentryCredential } from "./credentials.js";

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
        `projects/${pathSegment(p.org)}/${pathSegment(p.project)}/events/${pathSegment(p.eventId)}/`,
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
        `projects/${pathSegment(p.org)}/${pathSegment(p.project)}/events/`,
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
        `issues/${pathSegment((input as Record<string, unknown>).issueId)}/`,
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
        `projects/${pathSegment(p.org)}/${pathSegment(p.project)}/issues/`,
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
      return apiRequest(ctx, "PUT", `issues/${pathSegment(issueId)}/`, fields);
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
        `issues/${pathSegment((input as Record<string, unknown>).issueId)}/`,
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
        `organizations/${pathSegment((input as Record<string, unknown>).org)}/`,
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
        `projects/${pathSegment(p.org)}/${pathSegment(p.project)}/`,
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
        `teams/${pathSegment(p.org)}/${pathSegment(p.team)}/projects/`,
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
        `projects/${pathSegment(p.org)}/${pathSegment(p.project)}/`,
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
        `organizations/${pathSegment(p.org)}/releases/${pathSegment(p.version)}/`,
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
        `organizations/${pathSegment(p.org)}/releases/`,
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
        `organizations/${pathSegment(p.org)}/releases/`,
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
        `organizations/${pathSegment(p.org)}/releases/${pathSegment(p.version)}/`,
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
      return apiRequest(
        ctx,
        "GET",
        `teams/${pathSegment(p.org)}/${pathSegment(p.team)}/`,
      );
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
        `organizations/${pathSegment(p.org)}/teams/`,
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
        `organizations/${pathSegment(p.org)}/teams/`,
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
      await apiRequest(
        ctx,
        "DELETE",
        `teams/${pathSegment(p.org)}/${pathSegment(p.team)}/`,
      );
      return { success: true };
    },
  });
}
