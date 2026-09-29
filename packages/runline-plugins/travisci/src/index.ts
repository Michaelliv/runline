import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialJson,
  pathSegment,
  slashEncodedSegment,
} from "../../_shared/credentials.js";
import { travisciCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: unknown,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, travisciCredential, "travisci", {
    target: "api",
    path,
    method,
    query,
    headers: { "Travis-API-Version": "3" },
    ...(body !== undefined ? { json: body } : {}),
  });
}

export default function travisci(rl: RunlinePluginAPI) {
  rl.setName("travisci");
  rl.setVersion("0.1.0");
  rl.setCredential(travisciCredential);

  rl.setConnectionSchema({
    apiToken: {
      type: "string",
      required: true,
      description: "Travis CI API token",
      env: "TRAVISCI_API_TOKEN",
    },
  });

  rl.registerAction("build.get", {
    access: "read",
    description: "Get a build by ID",
    inputSchema: { buildId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `build/${pathSegment((input as Record<string, unknown>).buildId)}`,
      );
    },
  });

  rl.registerAction("build.list", {
    access: "read",
    description: "List builds for the current user",
    inputSchema: {
      limit: { type: "number", required: false },
      sortBy: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      if (p.sortBy) qs.sort_by = p.sortBy;
      const data = (await apiRequest(
        ctx,
        "GET",
        "builds",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.builds;
    },
  });

  rl.registerAction("build.cancel", {
    access: "write",
    description: "Cancel a build",
    inputSchema: { buildId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "POST",
        `build/${pathSegment((input as Record<string, unknown>).buildId)}/cancel`,
      );
    },
  });

  rl.registerAction("build.restart", {
    access: "write",
    description: "Restart a build",
    inputSchema: { buildId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "POST",
        `build/${pathSegment((input as Record<string, unknown>).buildId)}/restart`,
      );
    },
  });

  rl.registerAction("build.trigger", {
    access: "write",
    description: "Trigger a build for a repository",
    inputSchema: {
      slug: {
        type: "string",
        required: true,
        description: "Repository slug (owner/name)",
      },
      branch: { type: "string", required: true },
      message: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const request: Record<string, unknown> = { branch: p.branch };
      if (p.message) request.message = p.message;
      return apiRequest(
        ctx,
        "POST",
        `repo/${slashEncodedSegment(p.slug)}/requests`,
        {
          request,
        },
      );
    },
  });
}
