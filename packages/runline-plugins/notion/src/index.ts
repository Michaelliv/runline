import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { NOTION_VERSION, notionCredential } from "./credentials.js";

function api(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, notionCredential, "notion", {
    target: "api",
    path,
    method,
    query,
    headers: { "Notion-Version": NOTION_VERSION },
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

export default function notion(rl: RunlinePluginAPI) {
  rl.setName("notion");
  rl.setVersion("0.1.0");
  rl.setCredential(notionCredential);
  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Notion integration token (secret_...)",
      env: "NOTION_API_KEY",
    },
  });

  // ── Block ───────────────────────────────────────────

  rl.registerAction("block.append", {
    access: "write",
    description: "Append children blocks to a block/page",
    inputSchema: {
      blockId: { type: "string", required: true },
      children: {
        type: "object",
        required: true,
        description: "Array of block objects",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(ctx, "PATCH", `blocks/${pathSegment(p.blockId)}/children`, {
        children: p.children,
      });
    },
  });

  rl.registerAction("block.getChildren", {
    access: "read",
    description: "Get child blocks of a block/page",
    inputSchema: {
      blockId: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.page_size = p.limit;
      const data = (await api(
        ctx,
        "GET",
        `blocks/${pathSegment(p.blockId)}/children`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.results;
    },
  });

  rl.registerAction("block.delete", {
    access: "write",
    description: "Delete (archive) a block",
    inputSchema: { blockId: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "DELETE",
        `blocks/${pathSegment((input as Record<string, unknown>).blockId)}`,
      );
    },
  });

  // ── Database ────────────────────────────────────────

  rl.registerAction("database.get", {
    access: "read",
    description: "Get a database",
    inputSchema: { databaseId: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `databases/${pathSegment((input as Record<string, unknown>).databaseId)}`,
      );
    },
  });

  rl.registerAction("database.list", {
    access: "read",
    description: "List all databases (via search)",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const body: Record<string, unknown> = {
        filter: { property: "object", value: "database" },
      };
      if ((input as Record<string, unknown>)?.limit)
        body.page_size = (input as Record<string, unknown>).limit;
      const data = (await api(ctx, "POST", "search", body)) as Record<
        string,
        unknown
      >;
      return data.results;
    },
  });

  rl.registerAction("database.query", {
    access: "read",
    description: "Query a database (list pages with filters)",
    inputSchema: {
      databaseId: { type: "string", required: true },
      filter: {
        type: "object",
        required: false,
        description: "Notion filter object",
      },
      sorts: {
        type: "object",
        required: false,
        description: "Array of sort objects",
      },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.filter) body.filter = p.filter;
      if (p.sorts) body.sorts = p.sorts;
      if (p.limit) body.page_size = p.limit;
      const data = (await api(
        ctx,
        "POST",
        `databases/${pathSegment(p.databaseId)}/query`,
        body,
      )) as Record<string, unknown>;
      return data.results;
    },
  });

  // ── Page ────────────────────────────────────────────

  rl.registerAction("page.create", {
    access: "write",
    description: "Create a page (in a database or under a page)",
    inputSchema: {
      parent: {
        type: "object",
        required: true,
        description: "{ database_id: '...' } or { page_id: '...' }",
      },
      properties: {
        type: "object",
        required: true,
        description: "Page properties",
      },
      children: {
        type: "object",
        required: false,
        description: "Array of block children",
      },
      icon: { type: "object", required: false },
    },
    async execute(input, ctx) {
      return api(ctx, "POST", "pages", input as Record<string, unknown>);
    },
  });

  rl.registerAction("page.get", {
    access: "read",
    description: "Get a page",
    inputSchema: { pageId: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `pages/${pathSegment((input as Record<string, unknown>).pageId)}`,
      );
    },
  });

  rl.registerAction("page.update", {
    access: "write",
    description: "Update page properties",
    inputSchema: {
      pageId: { type: "string", required: true },
      properties: { type: "object", required: false },
      archived: { type: "boolean", required: false },
      icon: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const { pageId, ...body } = input as Record<string, unknown>;
      return api(ctx, "PATCH", `pages/${pathSegment(pageId)}`, body);
    },
  });

  rl.registerAction("page.archive", {
    access: "write",
    description: "Archive a page",
    inputSchema: { pageId: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "PATCH",
        `pages/${pathSegment((input as Record<string, unknown>).pageId)}`,
        { archived: true },
      );
    },
  });

  rl.registerAction("page.search", {
    access: "read",
    description: "Search pages",
    inputSchema: {
      query: { type: "string", required: false },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.query) body.query = p.query;
      if (p.limit) body.page_size = p.limit;
      const data = (await api(ctx, "POST", "search", body)) as Record<
        string,
        unknown
      >;
      return data.results;
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.get", {
    access: "read",
    description: "Get a user",
    inputSchema: { userId: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `users/${pathSegment((input as Record<string, unknown>).userId)}`,
      );
    },
  });

  rl.registerAction("user.list", {
    access: "read",
    description: "List all users",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit)
        qs.page_size = (input as Record<string, unknown>).limit;
      const data = (await api(ctx, "GET", "users", undefined, qs)) as Record<
        string,
        unknown
      >;
      return data.results;
    },
  });

  rl.registerAction("user.me", {
    access: "read",
    description: "Get the bot user",
    inputSchema: {},
    async execute(_input, ctx) {
      return api(ctx, "GET", "users/me");
    },
  });
}
