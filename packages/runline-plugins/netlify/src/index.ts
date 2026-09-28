import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialJson,
  credentialRequest,
  pathSegment,
} from "../../_shared/credentials.js";
import { netlifyCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, netlifyCredential, "netlify", {
    target: "api",
    path,
    method,
    query,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

/** Page-numbered listing; the Link header only says whether a next page exists. */
async function paginate(
  ctx: ActionContext,
  path: string,
  query: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  let page = 0;
  const perPage = 100;
  while (true) {
    const response = await credentialRequest(ctx, netlifyCredential, {
      target: "api",
      path,
      query: { page, per_page: perPage, ...query },
    });
    if (!response.ok)
      throw new Error(`netlify: request failed (HTTP ${response.status})`);
    const items = (await response.json()) as unknown[];
    all.push(...items);
    const link = response.headers.get("link") ?? "";
    if (!link.includes("next")) break;
    page++;
  }
  return all;
}

export default function netlify(rl: RunlinePluginAPI) {
  rl.setName("netlify");
  rl.setVersion("0.1.0");
  rl.setCredential(netlifyCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Netlify personal access token",
      env: "NETLIFY_ACCESS_TOKEN",
    },
  });

  // ── Deploy ──────────────────────────────────────────

  rl.registerAction("deploy.cancel", {
    access: "write",
    description: "Cancel a deployment",
    inputSchema: {
      deployId: { type: "string", required: true, description: "Deploy ID" },
    },
    async execute(input, ctx) {
      const { deployId } = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", `deploys/${pathSegment(deployId)}/cancel`);
    },
  });

  rl.registerAction("deploy.create", {
    access: "write",
    description: "Create a new deployment for a site",
    inputSchema: {
      siteId: { type: "string", required: true, description: "Site ID" },
      branch: {
        type: "string",
        required: false,
        description: "Branch to deploy",
      },
      title: { type: "string", required: false, description: "Deploy title" },
    },
    async execute(input, ctx) {
      const { siteId, branch, title } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      const qs: Record<string, unknown> = {};
      if (branch) body.branch = branch;
      if (title) qs.title = title;
      return apiRequest(
        ctx,
        "POST",
        `sites/${pathSegment(siteId)}/deploys`,
        body,
        qs,
      );
    },
  });

  rl.registerAction("deploy.get", {
    access: "read",
    description: "Get a deployment",
    inputSchema: {
      siteId: { type: "string", required: true, description: "Site ID" },
      deployId: { type: "string", required: true, description: "Deploy ID" },
    },
    async execute(input, ctx) {
      const { siteId, deployId } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "GET",
        `sites/${pathSegment(siteId)}/deploys/${pathSegment(deployId)}`,
      );
    },
  });

  rl.registerAction("deploy.list", {
    access: "read",
    description: "List deployments for a site",
    inputSchema: {
      siteId: { type: "string", required: true, description: "Site ID" },
      limit: {
        type: "number",
        required: false,
        description: "Max results (default all)",
      },
    },
    async execute(input, ctx) {
      const { siteId, limit } = input as Record<string, unknown>;
      if (limit) {
        return apiRequest(
          ctx,
          "GET",
          `sites/${pathSegment(siteId)}/deploys`,
          undefined,
          {
            per_page: limit,
          },
        );
      }
      return paginate(ctx, `sites/${pathSegment(siteId)}/deploys`);
    },
  });

  // ── Site ────────────────────────────────────────────

  rl.registerAction("site.delete", {
    access: "write",
    description: "Delete a site",
    inputSchema: {
      siteId: { type: "string", required: true, description: "Site ID" },
    },
    async execute(input, ctx) {
      const { siteId } = input as Record<string, unknown>;
      return apiRequest(ctx, "DELETE", `sites/${pathSegment(siteId)}`);
    },
  });

  rl.registerAction("site.get", {
    access: "read",
    description: "Get a site",
    inputSchema: {
      siteId: { type: "string", required: true, description: "Site ID" },
    },
    async execute(input, ctx) {
      const { siteId } = input as Record<string, unknown>;
      return apiRequest(ctx, "GET", `sites/${pathSegment(siteId)}`);
    },
  });

  rl.registerAction("site.list", {
    access: "read",
    description: "List all sites",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results (default all)",
      },
    },
    async execute(input, ctx) {
      const limit = (input as Record<string, unknown>)?.limit;
      if (limit) {
        return apiRequest(ctx, "GET", "sites", undefined, {
          filter: "all",
          per_page: limit,
        });
      }
      return paginate(ctx, "sites", { filter: "all" });
    },
  });
}
