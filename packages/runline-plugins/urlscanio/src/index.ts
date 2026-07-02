import type { RunlinePluginAPI } from "runline";

const BASE = "https://urlscan.io/api/v1";

async function apiRequest(
  apiKey: string,
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
    headers: { "API-Key": apiKey, "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok)
    throw new Error(`urlscan.io error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function urlscanio(rl: RunlinePluginAPI) {
  rl.setName("urlscanio");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "urlscan.io API key",
      env: "URLSCANIO_API_KEY",
    },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.apiKey as string;

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
      return apiRequest(key(ctx), "POST", "/scan", body);
    },
  });

  rl.registerAction("scan.get", {
    access: "read",
    description: "Get scan results by ID",
    inputSchema: { scanId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        key(ctx),
        "GET",
        `/result/${(input as Record<string, unknown>).scanId}`,
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
        key(ctx),
        "GET",
        "/search",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.results;
    },
  });
}
