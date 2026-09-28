import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { rundeckCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, rundeckCredential, "rundeck", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

export default function rundeck(rl: RunlinePluginAPI) {
  rl.setName("rundeck");
  rl.setVersion("0.1.0");
  rl.setCredential(rundeckCredential);

  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "Rundeck server URL (e.g. https://rundeck.example.com)",
      env: "RUNDECK_URL",
    },
    token: {
      type: "string",
      required: true,
      description: "Rundeck API token",
      env: "RUNDECK_TOKEN",
    },
  });

  rl.registerAction("job.execute", {
    access: "write",
    description: "Execute a Rundeck job",
    inputSchema: {
      jobId: { type: "string", required: true },
      arguments: {
        type: "object",
        required: false,
        description: "Array of {name, value} argument pairs",
      },
      filter: {
        type: "string",
        required: false,
        description: "Node filter string",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      let argString = "";
      if (p.arguments) {
        for (const arg of p.arguments as Array<{
          name: string;
          value: string;
        }>) {
          argString += `-${arg.name} ${arg.value} `;
        }
      }
      const qs: Record<string, unknown> = {};
      if (p.filter) qs.filter = p.filter;
      return apiRequest(
        ctx,
        "POST",
        `14/job/${pathSegment(p.jobId)}/run`,
        { argString: argString.trim() },
        qs,
      );
    },
  });

  rl.registerAction("job.getMetadata", {
    access: "read",
    description: "Get metadata for a Rundeck job",
    inputSchema: { jobId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { jobId } = input as Record<string, unknown>;
      return apiRequest(ctx, "GET", `18/job/${pathSegment(jobId)}/info`);
    },
  });
}
