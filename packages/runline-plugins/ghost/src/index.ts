import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  url: string,
  adminApiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  // Ghost Admin API uses JWT. Key format: {id}:{secret}
  const [id, secret] = adminApiKey.split(":");
  // Create JWT manually using HMAC-SHA256
  const header = btoa(
    JSON.stringify({ alg: "HS256", typ: "JWT", kid: id }),
  ).replace(/=/g, "");
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(
    JSON.stringify({ iat: now, exp: now + 300, aud: "/admin/" }),
  ).replace(/=/g, "");
  const enc = new TextEncoder();
  const keyData = new Uint8Array(
    (secret.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
  );
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    enc.encode(`${header}.${payload}`),
  );
  const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  const token = `${header}.${payload}.${sigStr}`;

  const base = url.replace(/\/$/, "");
  const fullUrl = new URL(`${base}/ghost/api/v2/admin${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) fullUrl.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Ghost ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  ) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(fullUrl.toString(), opts);
  if (!res.ok)
    throw new Error(`Ghost API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    url: (ctx.connection.config.url as string).replace(/\/$/, ""),
    adminApiKey: ctx.connection.config.adminApiKey as string,
  };
}

function req(
  ctx: { connection: { config: Record<string, unknown> } },
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
) {
  const { url, adminApiKey } = getConn(ctx);
  return apiRequest(url, adminApiKey, method, endpoint, body, qs);
}

export default function ghost(rl: RunlinePluginAPI) {
  rl.setName("ghost");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "Ghost site URL (e.g. https://myblog.com)",
      env: "GHOST_URL",
    },
    adminApiKey: {
      type: "string",
      required: true,
      description: "Admin API key (format: {id}:{secret})",
      env: "GHOST_ADMIN_API_KEY",
    },
  });

  rl.registerAction("post.create", {
    access: "write",
    description: "Create a post",
    inputSchema: {
      title: { type: "string", required: true, description: "Post title" },
      html: {
        type: "string",
        required: false,
        description: "Post content as HTML",
      },
      lexical: {
        type: "string",
        required: false,
        description: "Post content as Lexical JSON",
      },
      status: {
        type: "string",
        required: false,
        description: "draft (default), published, or scheduled",
      },
      publishedAt: {
        type: "string",
        required: false,
        description: "Publish date (ISO 8601, required for scheduled)",
      },
      tags: {
        type: "array",
        required: false,
        description: "Array of tag names or {name} objects",
      },
      authors: {
        type: "array",
        required: false,
        description: "Array of {id} objects",
      },
      featured: {
        type: "boolean",
        required: false,
        description: "Mark as featured",
      },
      slug: { type: "string", required: false, description: "Custom slug" },
    },
    async execute(input, ctx) {
      const {
        title,
        html,
        lexical,
        status,
        publishedAt,
        tags,
        authors,
        featured,
        slug,
      } = input as Record<string, unknown>;
      const post: Record<string, unknown> = { title };
      const qs: Record<string, unknown> = {};
      if (html) {
        post.html = html;
        qs.source = "html";
      }
      if (lexical) post.lexical = lexical;
      if (status) post.status = status;
      if (publishedAt) post.published_at = publishedAt;
      if (tags)
        post.tags = (tags as unknown[]).map((t) =>
          typeof t === "string" ? { name: t } : t,
        );
      if (authors) post.authors = authors;
      if (featured !== undefined) post.featured = featured;
      if (slug) post.slug = slug;
      const data = (await req(
        ctx,
        "POST",
        "/posts/",
        { posts: [post] },
        qs,
      )) as Record<string, unknown>;
      return (data.posts as unknown[])?.[0];
    },
  });

  rl.registerAction("post.get", {
    access: "read",
    description: "Get a post by ID or slug",
    inputSchema: {
      id: { type: "string", required: false, description: "Post ID" },
      slug: { type: "string", required: false, description: "Post slug" },
      formats: {
        type: "string",
        required: false,
        description: "Response formats: html, mobiledoc, lexical",
      },
    },
    async execute(input, ctx) {
      const { id, slug, formats } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (formats) qs.formats = formats;
      let endpoint: string;
      if (slug) endpoint = `/posts/slug/${slug}/`;
      else if (id) endpoint = `/posts/${id}/`;
      else throw new Error("Provide either id or slug");
      const data = (await req(ctx, "GET", endpoint, undefined, qs)) as Record<
        string,
        unknown
      >;
      return (data.posts as unknown[])?.[0];
    },
  });

  rl.registerAction("post.list", {
    access: "read",
    description: "List posts",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results (default: 15)",
      },
      page: { type: "number", required: false, description: "Page number" },
      filter: {
        type: "string",
        required: false,
        description: "Ghost filter string (e.g. 'tag:news')",
      },
      formats: {
        type: "string",
        required: false,
        description: "Response formats",
      },
      order: {
        type: "string",
        required: false,
        description: "Order (e.g. 'published_at desc')",
      },
    },
    async execute(input, ctx) {
      const { limit, page, filter, formats, order } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (limit) qs.limit = limit;
      if (page) qs.page = page;
      if (filter) qs.filter = filter;
      if (formats) qs.formats = formats;
      if (order) qs.order = order;
      const data = (await req(ctx, "GET", "/posts/", undefined, qs)) as Record<
        string,
        unknown
      >;
      return data.posts;
    },
  });

  rl.registerAction("post.update", {
    access: "write",
    description: "Update a post",
    inputSchema: {
      postId: { type: "string", required: true, description: "Post ID" },
      title: { type: "string", required: false, description: "New title" },
      html: {
        type: "string",
        required: false,
        description: "New HTML content",
      },
      lexical: {
        type: "string",
        required: false,
        description: "New Lexical JSON content",
      },
      status: { type: "string", required: false, description: "New status" },
      publishedAt: {
        type: "string",
        required: false,
        description: "New publish date",
      },
      tags: { type: "array", required: false, description: "New tags" },
      featured: {
        type: "boolean",
        required: false,
        description: "Featured flag",
      },
      slug: { type: "string", required: false, description: "New slug" },
    },
    async execute(input, ctx) {
      const {
        postId,
        title,
        html,
        lexical,
        status,
        publishedAt,
        tags,
        featured,
        slug,
      } = input as Record<string, unknown>;
      // Need updated_at for optimistic locking
      const existing = (await req(ctx, "GET", `/posts/${postId}/`, undefined, {
        fields: "id,updated_at",
      })) as Record<string, unknown>;
      const currentPost = (existing.posts as Array<Record<string, unknown>>)[0];
      const post: Record<string, unknown> = {
        updated_at: currentPost.updated_at,
      };
      const qs: Record<string, unknown> = {};
      if (title) post.title = title;
      if (html) {
        post.html = html;
        qs.source = "html";
      }
      if (lexical) post.lexical = lexical;
      if (status) post.status = status;
      if (publishedAt) post.published_at = publishedAt;
      if (tags)
        post.tags = (tags as unknown[]).map((t) =>
          typeof t === "string" ? { name: t } : t,
        );
      if (featured !== undefined) post.featured = featured;
      if (slug) post.slug = slug;
      const data = (await req(
        ctx,
        "PUT",
        `/posts/${postId}/`,
        { posts: [post] },
        qs,
      )) as Record<string, unknown>;
      return (data.posts as unknown[])?.[0];
    },
  });

  rl.registerAction("post.delete", {
    access: "write",
    description: "Delete a post",
    inputSchema: {
      postId: { type: "string", required: true, description: "Post ID" },
    },
    async execute(input, ctx) {
      await req(
        ctx,
        "DELETE",
        `/posts/${(input as { postId: string }).postId}/`,
      );
      return { success: true };
    },
  });
}
