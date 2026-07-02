import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.raindrop.io/rest/v1";

async function apiRequest(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${endpoint}`, init);
  if (!res.ok)
    throw new Error(`Raindrop error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function raindrop(rl: RunlinePluginAPI) {
  rl.setName("raindrop");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Raindrop.io access token",
      env: "RAINDROP_ACCESS_TOKEN",
    },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.accessToken as string;

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
      const data = (await apiRequest(
        key(ctx),
        "POST",
        "/raindrop",
        body,
      )) as Record<string, unknown>;
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
        key(ctx),
        "GET",
        `/raindrop/${bookmarkId}`,
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
        key(ctx),
        "GET",
        `/raindrops/${p.collectionId}`,
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
        key(ctx),
        "PUT",
        `/raindrop/${p.bookmarkId}`,
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
      return apiRequest(key(ctx), "DELETE", `/raindrop/${bookmarkId}`);
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
        key(ctx),
        "POST",
        "/collection",
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
        key(ctx),
        "GET",
        `/collection/${collectionId}`,
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
        p.type === "children" ? "/collections/childrens" : "/collections";
      const data = (await apiRequest(key(ctx), "GET", endpoint)) as Record<
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
        key(ctx),
        "PUT",
        `/collection/${p.collectionId}`,
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
      return apiRequest(key(ctx), "DELETE", `/collection/${collectionId}`);
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
      const endpoint = p.collectionId ? `/tags/${p.collectionId}` : "/tags";
      const data = (await apiRequest(key(ctx), "GET", endpoint)) as Record<
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
      const endpoint = p.collectionId ? `/tags/${p.collectionId}` : "/tags";
      return apiRequest(key(ctx), "DELETE", endpoint, {
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
      const endpoint = userId ? `/user/${userId}` : "/user";
      const data = (await apiRequest(key(ctx), "GET", endpoint)) as Record<
        string,
        unknown
      >;
      return data.user;
    },
  });
}
