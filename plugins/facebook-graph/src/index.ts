import type { RunlinePluginAPI } from "runline";

async function graphRequest(
  accessToken: string,
  method: string,
  host: string,
  version: string,
  node: string,
  edge?: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
  fields?: string[],
): Promise<unknown> {
  const path = edge ? `/${version}/${node}/${edge}` : `/${version}/${node}`;
  const url = new URL(`https://${host}${path}`);
  url.searchParams.set("access_token", accessToken);
  if (fields && fields.length > 0) url.searchParams.set("fields", fields.join(","));
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Facebook Graph API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function facebookGraph(rl: RunlinePluginAPI) {
  rl.setName("facebook-graph");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "Facebook/Meta access token", env: "FACEBOOK_ACCESS_TOKEN" },
  });

  const tok = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.accessToken as string;

  rl.registerAction("graph.get", {
    description: "GET request to Facebook Graph API",
    inputSchema: {
      node: { type: "string", required: true, description: "Node ID (e.g. 'me', a page ID, user ID)" },
      edge: { type: "string", required: false, description: "Edge name (e.g. 'posts', 'feed', 'photos')" },
      fields: { type: "array", required: false, description: "Fields to request" },
      version: { type: "string", required: false, description: "API version (default: v19.0)" },
      queryParams: { type: "object", required: false, description: "Additional query parameters" },
    },
    async execute(input, ctx) {
      const { node, edge, fields, version = "v19.0", queryParams } = input as Record<string, unknown>;
      return graphRequest(tok(ctx), "GET", "graph.facebook.com", version as string, node as string, edge as string | undefined, undefined, queryParams as Record<string, unknown> | undefined, fields as string[] | undefined);
    },
  });

  rl.registerAction("graph.post", {
    description: "POST request to Facebook Graph API",
    inputSchema: {
      node: { type: "string", required: true, description: "Node ID" },
      edge: { type: "string", required: false, description: "Edge name" },
      body: { type: "object", required: true, description: "Request body" },
      version: { type: "string", required: false, description: "API version (default: v19.0)" },
    },
    async execute(input, ctx) {
      const { node, edge, body, version = "v19.0" } = input as Record<string, unknown>;
      return graphRequest(tok(ctx), "POST", "graph.facebook.com", version as string, node as string, edge as string | undefined, body as Record<string, unknown>);
    },
  });

  rl.registerAction("graph.delete", {
    description: "DELETE request to Facebook Graph API",
    inputSchema: {
      node: { type: "string", required: true, description: "Node ID to delete" },
      version: { type: "string", required: false, description: "API version (default: v19.0)" },
    },
    async execute(input, ctx) {
      const { node, version = "v19.0" } = input as Record<string, unknown>;
      return graphRequest(tok(ctx), "DELETE", "graph.facebook.com", version as string, node as string);
    },
  });

  rl.registerAction("video.upload", {
    description: "POST to the video upload endpoint (graph-video.facebook.com)",
    inputSchema: {
      node: { type: "string", required: true, description: "Node ID (page or user)" },
      body: { type: "object", required: true, description: "Video metadata (title, description, file_url, etc.)" },
      version: { type: "string", required: false, description: "API version (default: v19.0)" },
    },
    async execute(input, ctx) {
      const { node, body, version = "v19.0" } = input as Record<string, unknown>;
      return graphRequest(tok(ctx), "POST", "graph-video.facebook.com", version as string, node as string, "videos", body as Record<string, unknown>);
    },
  });
}
