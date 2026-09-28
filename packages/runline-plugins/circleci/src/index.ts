import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialJson,
  pathSegment as seg,
} from "../../_shared/credentials.js";
import { circleciCredential } from "./credentials.js";

async function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, circleciCredential, "circleci", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
}

async function paginateAll(
  ctx: ActionContext,
  path: string,
  qs?: Record<string, unknown>,
): Promise<unknown[]> {
  const results: unknown[] = [];
  const q = { ...qs };

  while (true) {
    const data = (await apiRequest(ctx, "GET", path, undefined, q)) as Record<
      string,
      unknown
    >;
    const items = (data.items as unknown[]) ?? [];
    results.push(...items);
    if (!data.next_page_token) break;
    q["page-token"] = data.next_page_token as string;
  }
  return results;
}

/** An org/repo slug as literal path segments, each part one encoded, non-empty segment. */
function encodeSlug(slug: string): string {
  return slug.split("/").map(seg).join("/");
}

export default function circleci(rl: RunlinePluginAPI) {
  rl.setName("circleci");
  rl.setVersion("0.1.0");
  rl.setCredential(circleciCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "CircleCI API token",
      env: "CIRCLECI_API_KEY",
    },
  });

  rl.registerAction("pipeline.get", {
    access: "read",
    description: "Get a specific pipeline by number",
    inputSchema: {
      vcs: {
        type: "string",
        required: true,
        description: "VCS type: github or bitbucket",
      },
      projectSlug: {
        type: "string",
        required: true,
        description: "Project slug (org/repo)",
      },
      pipelineNumber: {
        type: "number",
        required: true,
        description: "Pipeline number",
      },
    },
    async execute(input, ctx) {
      const { vcs, projectSlug, pipelineNumber } = input as {
        vcs: string;
        projectSlug: string;
        pipelineNumber: number;
      };
      return apiRequest(
        ctx,
        "GET",
        `project/${seg(vcs)}/${encodeSlug(projectSlug)}/pipeline/${seg(pipelineNumber)}`,
      );
    },
  });

  rl.registerAction("pipeline.list", {
    access: "read",
    description: "List pipelines for a project",
    inputSchema: {
      vcs: {
        type: "string",
        required: true,
        description: "VCS type: github or bitbucket",
      },
      projectSlug: {
        type: "string",
        required: true,
        description: "Project slug (org/repo)",
      },
      branch: {
        type: "string",
        required: false,
        description: "Filter by branch",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results (omit for all)",
      },
    },
    async execute(input, ctx) {
      const { vcs, projectSlug, branch, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const endpoint = `project/${seg(vcs)}/${encodeSlug(projectSlug as string)}/pipeline`;
      const qs: Record<string, unknown> = {};
      if (branch) qs.branch = branch;

      if (limit) {
        qs.limit = limit;
        const data = (await apiRequest(
          ctx,
          "GET",
          endpoint,
          undefined,
          qs,
        )) as Record<string, unknown>;
        return ((data.items as unknown[]) ?? []).slice(0, limit as number);
      }
      return paginateAll(ctx, endpoint, qs);
    },
  });

  rl.registerAction("pipeline.trigger", {
    access: "write",
    description: "Trigger a new pipeline",
    inputSchema: {
      vcs: {
        type: "string",
        required: true,
        description: "VCS type: github or bitbucket",
      },
      projectSlug: {
        type: "string",
        required: true,
        description: "Project slug (org/repo)",
      },
      branch: {
        type: "string",
        required: false,
        description: "Branch to build",
      },
      tag: { type: "string", required: false, description: "Tag to build" },
    },
    async execute(input, ctx) {
      const { vcs, projectSlug, branch, tag } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {};
      if (branch) body.branch = branch;
      if (tag) body.tag = tag;
      return apiRequest(
        ctx,
        "POST",
        `project/${seg(vcs)}/${encodeSlug(projectSlug as string)}/pipeline`,
        body,
      );
    },
  });
}
