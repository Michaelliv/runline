import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { urlscanioCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, urlscanioCredential, "urlscanio", {
    target: "api",
    path,
    method,
    query,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

export default function urlscanio(rl: RunlinePluginAPI) {
  rl.setName("urlscanio");
  rl.setVersion("0.1.0");
  rl.setCredential(urlscanioCredential);
  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "urlscan.io API key",
      env: "URLSCANIO_API_KEY",
    },
  });

  rl.registerAction("scan.perform", {
    access: "write",
    description: "Submit a URL for scanning",
    inputSchema: {
      url: { type: "string", required: true },
      visibility: {
        type: "string",
        required: false,
        description: "public, private, or unlisted",
      },
      tags: {
        type: "string",
        required: false,
        description: "Comma-separated tags (max 10)",
      },
      customAgent: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { url: p.url };
      if (p.visibility) body.visibility = p.visibility;
      if (p.tags)
        body.tags = (p.tags as string).split(",").map((t) => t.trim());
      if (p.customAgent) body.customAgent = p.customAgent;
      return apiRequest(ctx, "POST", "scan", body);
    },
  });

  rl.registerAction("scan.get", {
    access: "read",
    description: "Get scan results by ID",
    inputSchema: { scanId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `result/${seg((input as Record<string, unknown>).scanId)}`,
      );
    },
  });

  rl.registerAction("scan.search", {
    access: "read",
    description: "Search scan results",
    inputSchema: {
      query: { type: "string", required: false, description: "Search query" },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { size: p.limit ?? 100 };
      if (p.query) qs.q = p.query;
      const data = (await apiRequest(
        ctx,
        "GET",
        "search",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.results;
    },
  });
}
