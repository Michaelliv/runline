import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://circleci.com/api/v2";

async function apiRequest(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const opts: RequestInit = {
    method,
    headers: {
      "Circle-Token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET") {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CircleCI API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function paginateAll(
  token: string,
  endpoint: string,
  qs?: Record<string, unknown>,
): Promise<unknown[]> {
  const results: unknown[] = [];
  const q = { ...qs };

  while (true) {
    const data = (await apiRequest(token, "GET", endpoint, undefined, q)) as Record<string, unknown>;
    const items = (data.items as unknown[]) ?? [];
    results.push(...items);
    if (!data.next_page_token) break;
    q["page-token"] = data.next_page_token as string;
  }
  return results;
}

function getToken(ctx: { connection: { config: Record<string, unknown> } }): string {
  return ctx.connection.config.apiKey as string;
}

function encodeSlug(slug: string): string {
  return slug.replace(/\//g, "%2F");
}

export default function circleci(rl: RunlinePluginAPI) {
  rl.setName("circleci");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "CircleCI API token",
      env: "CIRCLECI_API_KEY",
    },
  });

  rl.registerAction("pipeline.get", {
    description: "Get a specific pipeline by number",
    inputSchema: {
      vcs: { type: "string", required: true, description: "VCS type: github or bitbucket" },
      projectSlug: { type: "string", required: true, description: "Project slug (org/repo)" },
      pipelineNumber: { type: "number", required: true, description: "Pipeline number" },
    },
    async execute(input, ctx) {
      const { vcs, projectSlug, pipelineNumber } = input as {
        vcs: string;
        projectSlug: string;
        pipelineNumber: number;
      };
      return apiRequest(
        getToken(ctx),
        "GET",
        `/project/${vcs}/${encodeSlug(projectSlug)}/pipeline/${pipelineNumber}`,
      );
    },
  });

  rl.registerAction("pipeline.list", {
    description: "List pipelines for a project",
    inputSchema: {
      vcs: { type: "string", required: true, description: "VCS type: github or bitbucket" },
      projectSlug: { type: "string", required: true, description: "Project slug (org/repo)" },
      branch: { type: "string", required: false, description: "Filter by branch" },
      limit: { type: "number", required: false, description: "Max results (omit for all)" },
    },
    async execute(input, ctx) {
      const { vcs, projectSlug, branch, limit } = (input ?? {}) as Record<string, unknown>;
      const token = getToken(ctx);
      const endpoint = `/project/${vcs}/${encodeSlug(projectSlug as string)}/pipeline`;
      const qs: Record<string, unknown> = {};
      if (branch) qs.branch = branch;

      if (limit) {
        qs.limit = limit;
        const data = (await apiRequest(token, "GET", endpoint, undefined, qs)) as Record<string, unknown>;
        return ((data.items as unknown[]) ?? []).slice(0, limit as number);
      }
      return paginateAll(token, endpoint, qs);
    },
  });

  rl.registerAction("pipeline.trigger", {
    description: "Trigger a new pipeline",
    inputSchema: {
      vcs: { type: "string", required: true, description: "VCS type: github or bitbucket" },
      projectSlug: { type: "string", required: true, description: "Project slug (org/repo)" },
      branch: { type: "string", required: false, description: "Branch to build" },
      tag: { type: "string", required: false, description: "Tag to build" },
    },
    async execute(input, ctx) {
      const { vcs, projectSlug, branch, tag } = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (branch) body.branch = branch;
      if (tag) body.tag = tag;
      return apiRequest(
        getToken(ctx),
        "POST",
        `/project/${vcs}/${encodeSlug(projectSlug as string)}/pipeline`,
        body,
      );
    },
  });
}
