import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.medium.com/v1";

async function apiRequest(
  token: string, method: string, endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "Accept-Charset": "utf-8" },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET") opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${endpoint}`, opts);
  if (!res.ok) throw new Error(`Medium API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function medium(rl: RunlinePluginAPI) {
  rl.setName("medium");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "Medium integration token", env: "MEDIUM_ACCESS_TOKEN" },
  });

  const tok = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.accessToken as string;

  rl.registerAction("post.create", {
    description: "Create a post on Medium. Posts under the authenticated user by default, or under a publication if publicationId is provided.",
    inputSchema: {
      title: { type: "string", required: true, description: "Post title (max 100 chars)" },
      contentFormat: { type: "string", required: true, description: "'html' or 'markdown'" },
      content: { type: "string", required: true, description: "Post body in the specified format" },
      publicationId: { type: "string", required: false, description: "Publication ID to post under (omit for personal post)" },
      tags: { type: "array", required: false, description: "Array of tag strings (max 5, each max 25 chars)" },
      canonicalUrl: { type: "string", required: false, description: "Original URL if cross-posting" },
      publishStatus: { type: "string", required: false, description: "'public' (default), 'draft', or 'unlisted'" },
      license: { type: "string", required: false, description: "License: all-rights-reserved, cc-40-by, cc-40-by-nc, cc-40-by-nc-nd, cc-40-by-nc-sa, cc-40-by-nd, cc-40-by-sa, cc-40-zero, public-domain" },
      notifyFollowers: { type: "boolean", required: false, description: "Notify followers" },
    },
    async execute(input, ctx) {
      const { title, contentFormat, content, publicationId, tags, canonicalUrl, publishStatus, license, notifyFollowers } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { title, contentFormat, content, tags: tags ?? [] };
      if (canonicalUrl) body.canonicalUrl = canonicalUrl;
      if (publishStatus) body.publishStatus = publishStatus;
      if (license) body.license = license;
      if (notifyFollowers !== undefined) body.notifyFollowers = notifyFollowers;

      if (publicationId) {
        const resp = (await apiRequest(tok(ctx), "POST", `/publications/${publicationId}/posts`, body)) as Record<string, unknown>;
        return resp.data;
      }

      // Get authenticated user ID first
      const me = (await apiRequest(tok(ctx), "GET", "/me")) as Record<string, unknown>;
      const authorId = (me.data as Record<string, unknown>).id;
      const resp = (await apiRequest(tok(ctx), "POST", `/users/${authorId}/posts`, body)) as Record<string, unknown>;
      return resp.data;
    },
  });

  rl.registerAction("publication.list", {
    description: "List publications for the authenticated user",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as Record<string, unknown>;
      const me = (await apiRequest(tok(ctx), "GET", "/me")) as Record<string, unknown>;
      const userId = (me.data as Record<string, unknown>).id;
      const resp = (await apiRequest(tok(ctx), "GET", `/users/${userId}/publications`)) as Record<string, unknown>;
      let data = resp.data as unknown[];
      if (limit) data = data.slice(0, limit as number);
      return data;
    },
  });

  rl.registerAction("me", {
    description: "Get the authenticated user's profile",
    async execute(_input, ctx) {
      const resp = (await apiRequest(tok(ctx), "GET", "/me")) as Record<string, unknown>;
      return resp.data;
    },
  });
}
