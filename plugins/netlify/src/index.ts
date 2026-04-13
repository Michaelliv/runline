import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.netlify.com/api/v1";

interface Conn { config: Record<string, unknown> }

function getToken(ctx: { connection: Conn }): string {
  return ctx.connection.config.accessToken as string;
}

async function apiRequest(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
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
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Netlify API error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function paginate(
  token: string,
  endpoint: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  let page = 0;
  const perPage = 100;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url = new URL(`${BASE}${endpoint}`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Netlify API error ${res.status}: ${await res.text()}`);
    const items = (await res.json()) as unknown[];
    all.push(...items);
    const link = res.headers.get("link") ?? "";
    if (!link.includes("next")) break;
    page++;
  }
  return all;
}

export default function netlify(rl: RunlinePluginAPI) {
  rl.setName("netlify");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "Netlify personal access token", env: "NETLIFY_ACCESS_TOKEN" },
  });

  // ── Deploy ──────────────────────────────────────────

  rl.registerAction("deploy.cancel", {
    description: "Cancel a deployment",
    inputSchema: {
      deployId: { type: "string", required: true, description: "Deploy ID" },
    },
    async execute(input, ctx) {
      const { deployId } = input as Record<string, unknown>;
      return apiRequest(getToken(ctx), "POST", `/deploys/${deployId}/cancel`);
    },
  });

  rl.registerAction("deploy.create", {
    description: "Create a new deployment for a site",
    inputSchema: {
      siteId: { type: "string", required: true, description: "Site ID" },
      branch: { type: "string", required: false, description: "Branch to deploy" },
      title: { type: "string", required: false, description: "Deploy title" },
    },
    async execute(input, ctx) {
      const { siteId, branch, title } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      const qs: Record<string, unknown> = {};
      if (branch) body.branch = branch;
      if (title) qs.title = title;
      return apiRequest(getToken(ctx), "POST", `/sites/${siteId}/deploys`, body, qs);
    },
  });

  rl.registerAction("deploy.get", {
    description: "Get a deployment",
    inputSchema: {
      siteId: { type: "string", required: true, description: "Site ID" },
      deployId: { type: "string", required: true, description: "Deploy ID" },
    },
    async execute(input, ctx) {
      const { siteId, deployId } = input as Record<string, unknown>;
      return apiRequest(getToken(ctx), "GET", `/sites/${siteId}/deploys/${deployId}`);
    },
  });

  rl.registerAction("deploy.list", {
    description: "List deployments for a site",
    inputSchema: {
      siteId: { type: "string", required: true, description: "Site ID" },
      limit: { type: "number", required: false, description: "Max results (default all)" },
    },
    async execute(input, ctx) {
      const { siteId, limit } = input as Record<string, unknown>;
      const token = getToken(ctx);
      if (limit) {
        return apiRequest(token, "GET", `/sites/${siteId}/deploys`, undefined, { per_page: limit });
      }
      return paginate(token, `/sites/${siteId}/deploys`);
    },
  });

  // ── Site ────────────────────────────────────────────

  rl.registerAction("site.delete", {
    description: "Delete a site",
    inputSchema: {
      siteId: { type: "string", required: true, description: "Site ID" },
    },
    async execute(input, ctx) {
      const { siteId } = input as Record<string, unknown>;
      return apiRequest(getToken(ctx), "DELETE", `/sites/${siteId}`);
    },
  });

  rl.registerAction("site.get", {
    description: "Get a site",
    inputSchema: {
      siteId: { type: "string", required: true, description: "Site ID" },
    },
    async execute(input, ctx) {
      const { siteId } = input as Record<string, unknown>;
      return apiRequest(getToken(ctx), "GET", `/sites/${siteId}`);
    },
  });

  rl.registerAction("site.list", {
    description: "List all sites",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results (default all)" },
    },
    async execute(input, ctx) {
      const token = getToken(ctx);
      const limit = (input as Record<string, unknown>)?.limit;
      if (limit) {
        return apiRequest(token, "GET", "/sites", undefined, { filter: "all", per_page: limit });
      }
      return paginate(token, "/sites", { filter: "all" });
    },
  });
}
