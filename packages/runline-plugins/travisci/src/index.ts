import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.travis-ci.com";

async function apiRequest(
  token: string,
  method: string,
  endpoint: string,
  body?: unknown,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `token ${token}`,
      "Travis-API-Version": "3",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined)
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok)
    throw new Error(`TravisCI error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function travisci(rl: RunlinePluginAPI) {
  rl.setName("travisci");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    apiToken: {
      type: "string",
      required: true,
      description: "Travis CI API token",
      env: "TRAVISCI_API_TOKEN",
    },
  });
  const key = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.apiToken as string;

  rl.registerAction("build.get", {
    access: "read",
    description: "Get a build by ID",
    inputSchema: { buildId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        key(ctx),
        "GET",
        `/build/${(input as Record<string, unknown>).buildId}`,
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
        key(ctx),
        "GET",
        "/builds",
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
        key(ctx),
        "POST",
        `/build/${(input as Record<string, unknown>).buildId}/cancel`,
      );
    },
  });

  rl.registerAction("build.restart", {
    access: "write",
    description: "Restart a build",
    inputSchema: { buildId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        key(ctx),
        "POST",
        `/build/${(input as Record<string, unknown>).buildId}/restart`,
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
      const slug = (p.slug as string).replace(/\//g, "%2F");
      const request: Record<string, unknown> = { branch: p.branch };
      if (p.message) request.message = p.message;
      return apiRequest(key(ctx), "POST", `/repo/${slug}/requests`, {
        request,
      });
    },
  });
}
