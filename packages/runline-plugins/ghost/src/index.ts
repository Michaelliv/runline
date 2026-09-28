import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { ghostCredential } from "./credentials.js";

/** A Ghost Admin API call; GET and DELETE carry no body. */
function req(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, ghostCredential, "ghost", {
    target: "admin",
    path,
    method,
    query,
    ...(body && method !== "GET" && method !== "DELETE" ? { json: body } : {}),
  });
}

export default function ghost(rl: RunlinePluginAPI) {
  rl.setName("ghost");
  rl.setVersion("0.1.0");
  rl.setCredential(ghostCredential);

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
        "posts/",
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
      if (slug) endpoint = `posts/slug/${pathSegment(slug)}/`;
      else if (id) endpoint = `posts/${pathSegment(id)}/`;
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
      const data = (await req(ctx, "GET", "posts/", undefined, qs)) as Record<
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
      const existing = (await req(
        ctx,
        "GET",
        `posts/${pathSegment(postId)}/`,
        undefined,
        {
          fields: "id,updated_at",
        },
      )) as Record<string, unknown>;
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
        `posts/${pathSegment(postId)}/`,
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
        `posts/${pathSegment((input as { postId: string }).postId)}/`,
      );
      return { success: true };
    },
  });
}
