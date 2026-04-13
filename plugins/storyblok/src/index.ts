import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return { contentToken: c.contentToken as string | undefined, managementToken: c.managementToken as string | undefined };
}

async function contentApi(token: string, endpoint: string, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`https://api.storyblok.com${endpoint}`);
  url.searchParams.set("token", token);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Storyblok Content API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function managementApi(token: string, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`https://mapi.storyblok.com${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: token, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Storyblok Management API error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export default function storyblok(rl: RunlinePluginAPI) {
  rl.setName("storyblok");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    contentToken: { type: "string", required: false, description: "Storyblok Content Delivery API token (for reading published content)", env: "STORYBLOK_CONTENT_TOKEN" },
    managementToken: { type: "string", required: false, description: "Storyblok Management API personal access token", env: "STORYBLOK_MANAGEMENT_TOKEN" },
  });

  // ── Content API ─────────────────────────────────────

  rl.registerAction("content.story.get", {
    description: "Get a published story by slug or ID (Content API)",
    inputSchema: { identifier: { type: "string", required: true, description: "Story slug or numeric ID" } },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      if (!conn.contentToken) throw new Error("contentToken required for Content API");
      const data = (await contentApi(conn.contentToken, `/v1/cdn/stories/${(input as Record<string, unknown>).identifier}`)) as Record<string, unknown>;
      return data.story;
    },
  });

  rl.registerAction("content.story.list", {
    description: "List published stories (Content API)",
    inputSchema: { limit: { type: "number", required: false }, startsWith: { type: "string", required: false, description: "Filter by slug prefix" } },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      if (!conn.contentToken) throw new Error("contentToken required for Content API");
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.per_page = p.limit;
      if (p.startsWith) qs.starts_with = p.startsWith;
      const data = (await contentApi(conn.contentToken, "/v1/cdn/stories", qs)) as Record<string, unknown>;
      return data.stories;
    },
  });

  // ── Management API ──────────────────────────────────

  rl.registerAction("management.story.get", {
    description: "Get a story by ID (Management API)",
    inputSchema: { spaceId: { type: "string", required: true }, storyId: { type: "string", required: true } },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      if (!conn.managementToken) throw new Error("managementToken required for Management API");
      const p = input as Record<string, unknown>;
      const data = (await managementApi(conn.managementToken, "GET", `/v1/spaces/${p.spaceId}/stories/${p.storyId}`)) as Record<string, unknown>;
      return data.story;
    },
  });

  rl.registerAction("management.story.list", {
    description: "List stories in a space (Management API)",
    inputSchema: { spaceId: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      if (!conn.managementToken) throw new Error("managementToken required for Management API");
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.per_page = p.limit;
      const data = (await managementApi(conn.managementToken, "GET", `/v1/spaces/${p.spaceId}/stories`, undefined, qs)) as Record<string, unknown>;
      return data.stories;
    },
  });

  rl.registerAction("management.story.delete", {
    description: "Delete a story (Management API)",
    inputSchema: { spaceId: { type: "string", required: true }, storyId: { type: "string", required: true } },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      if (!conn.managementToken) throw new Error("managementToken required for Management API");
      const p = input as Record<string, unknown>;
      const data = (await managementApi(conn.managementToken, "DELETE", `/v1/spaces/${p.spaceId}/stories/${p.storyId}`)) as Record<string, unknown>;
      return data.story;
    },
  });

  rl.registerAction("management.story.publish", {
    description: "Publish a story (Management API)",
    inputSchema: { spaceId: { type: "string", required: true }, storyId: { type: "string", required: true }, releaseId: { type: "string", required: false }, language: { type: "string", required: false } },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      if (!conn.managementToken) throw new Error("managementToken required for Management API");
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.releaseId) qs.release_id = p.releaseId;
      if (p.language) qs.lang = p.language;
      const data = (await managementApi(conn.managementToken, "GET", `/v1/spaces/${p.spaceId}/stories/${p.storyId}/publish`, undefined, qs)) as Record<string, unknown>;
      return data.story;
    },
  });

  rl.registerAction("management.story.unpublish", {
    description: "Unpublish a story (Management API)",
    inputSchema: { spaceId: { type: "string", required: true }, storyId: { type: "string", required: true } },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      if (!conn.managementToken) throw new Error("managementToken required for Management API");
      const p = input as Record<string, unknown>;
      const data = (await managementApi(conn.managementToken, "GET", `/v1/spaces/${p.spaceId}/stories/${p.storyId}/unpublish`)) as Record<string, unknown>;
      return data.story;
    },
  });
}
