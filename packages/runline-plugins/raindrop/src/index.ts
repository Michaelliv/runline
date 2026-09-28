import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { raindropCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, raindropCredential, "raindrop", {
    target: "api",
    path: endpoint,
    method,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

export default function raindrop(rl: RunlinePluginAPI) {
  rl.setName("raindrop");
  rl.setVersion("0.1.0");
  rl.setCredential(raindropCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Raindrop.io access token",
      env: "RAINDROP_ACCESS_TOKEN",
    },
  });

  // ── Bookmark ────────────────────────────────────────

  rl.registerAction("bookmark.create", {
    access: "write",
    description: "Create a bookmark (raindrop)",
    inputSchema: {
      link: { type: "string", required: true, description: "URL to bookmark" },
      collectionId: { type: "string", required: true },
      title: { type: "string", required: false },
      tags: {
        type: "string",
        required: false,
        description: "Comma-separated tags",
      },
      pleaseParse: {
        type: "boolean",
        required: false,
        description: "Auto-parse page metadata",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        link: p.link,
        collection: { $id: Number(p.collectionId) },
      };
      if (p.title) body.title = p.title;
      if (p.tags)
        body.tags = (p.tags as string).split(",").map((t) => t.trim());
      if (p.pleaseParse) body.pleaseParse = {};
      const data = (await apiRequest(ctx, "POST", "raindrop", body)) as Record<
        string,
        unknown
      >;
      return data.item;
    },
  });

  rl.registerAction("bookmark.get", {
    access: "read",
    description: "Get a bookmark by ID",
    inputSchema: { bookmarkId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { bookmarkId } = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "GET",
        `raindrop/${pathSegment(bookmarkId)}`,
      )) as Record<string, unknown>;
      return data.item;
    },
  });

  rl.registerAction("bookmark.list", {
    access: "read",
    description: "List bookmarks in a collection",
    inputSchema: {
      collectionId: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "GET",
        `raindrops/${pathSegment(p.collectionId)}`,
      )) as Record<string, unknown>;
      let items = (data.items ?? []) as unknown[];
      if (p.limit) items = items.slice(0, p.limit as number);
      return items;
    },
  });

  rl.registerAction("bookmark.update", {
    access: "write",
    description: "Update a bookmark",
    inputSchema: {
      bookmarkId: { type: "string", required: true },
      title: { type: "string", required: false },
      link: { type: "string", required: false },
      tags: {
        type: "string",
        required: false,
        description: "Comma-separated tags",
      },
      collectionId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.title) body.title = p.title;
      if (p.link) body.link = p.link;
      if (p.tags)
        body.tags = (p.tags as string).split(",").map((t) => t.trim());
      if (p.collectionId) body.collection = { $id: Number(p.collectionId) };
      const data = (await apiRequest(
        ctx,
        "PUT",
        `raindrop/${pathSegment(p.bookmarkId)}`,
        body,
      )) as Record<string, unknown>;
      return data.item;
    },
  });

  rl.registerAction("bookmark.delete", {
    access: "write",
    description: "Delete a bookmark",
    inputSchema: { bookmarkId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { bookmarkId } = input as Record<string, unknown>;
      return apiRequest(ctx, "DELETE", `raindrop/${pathSegment(bookmarkId)}`);
    },
  });

  // ── Collection ──────────────────────────────────────

  rl.registerAction("collection.create", {
    access: "write",
    description: "Create a collection",
    inputSchema: {
      title: { type: "string", required: true },
      parentId: {
        type: "string",
        required: false,
        description: "Parent collection ID",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { title: p.title };
      if (p.parentId) body["parent.$id"] = Number(p.parentId);
      const data = (await apiRequest(
        ctx,
        "POST",
        "collection",
        body,
      )) as Record<string, unknown>;
      return data.item;
    },
  });

  rl.registerAction("collection.get", {
    access: "read",
    description: "Get a collection by ID",
    inputSchema: { collectionId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { collectionId } = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "GET",
        `collection/${pathSegment(collectionId)}`,
      )) as Record<string, unknown>;
      return data.item;
    },
  });

  rl.registerAction("collection.list", {
    access: "read",
    description: "List collections",
    inputSchema: {
      type: {
        type: "string",
        required: false,
        description: "parent (default) or children",
      },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const endpoint =
        p.type === "children" ? "collections/childrens" : "collections";
      const data = (await apiRequest(ctx, "GET", endpoint)) as Record<
        string,
        unknown
      >;
      let items = (data.items ?? []) as unknown[];
      if (p.limit) items = items.slice(0, p.limit as number);
      return items;
    },
  });

  rl.registerAction("collection.update", {
    access: "write",
    description: "Update a collection",
    inputSchema: {
      collectionId: { type: "string", required: true },
      title: { type: "string", required: false },
      parentId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.title) body.title = p.title;
      if (p.parentId) body["parent.$id"] = Number(p.parentId);
      const data = (await apiRequest(
        ctx,
        "PUT",
        `collection/${pathSegment(p.collectionId)}`,
        body,
      )) as Record<string, unknown>;
      return data.item;
    },
  });

  rl.registerAction("collection.delete", {
    access: "write",
    description: "Delete a collection",
    inputSchema: { collectionId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { collectionId } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "DELETE",
        `collection/${pathSegment(collectionId)}`,
      );
    },
  });

  // ── Tag ─────────────────────────────────────────────

  rl.registerAction("tag.list", {
    access: "read",
    description: "List tags (optionally filtered by collection)",
    inputSchema: {
      collectionId: { type: "string", required: false },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const endpoint = p.collectionId
        ? `tags/${pathSegment(p.collectionId)}`
        : "tags";
      const data = (await apiRequest(ctx, "GET", endpoint)) as Record<
        string,
        unknown
      >;
      let items = (data.items ?? []) as unknown[];
      if (p.limit) items = items.slice(0, p.limit as number);
      return items;
    },
  });

  rl.registerAction("tag.delete", {
    access: "write",
    description: "Delete tags",
    inputSchema: {
      tags: {
        type: "string",
        required: true,
        description: "Comma-separated tag names to delete",
      },
      collectionId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const endpoint = p.collectionId
        ? `tags/${pathSegment(p.collectionId)}`
        : "tags";
      return apiRequest(ctx, "DELETE", endpoint, {
        tags: (p.tags as string).split(",").map((t) => t.trim()),
      });
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.get", {
    access: "read",
    description: "Get user info (self or by ID)",
    inputSchema: {
      userId: {
        type: "string",
        required: false,
        description: "User ID (omit for self)",
      },
    },
    async execute(input, ctx) {
      const userId = (input as Record<string, unknown>)?.userId;
      const endpoint = userId ? `user/${pathSegment(userId)}` : "user";
      const data = (await apiRequest(ctx, "GET", endpoint)) as Record<
        string,
        unknown
      >;
      return data.user;
    },
  });
}
