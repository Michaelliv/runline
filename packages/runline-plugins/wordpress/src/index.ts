import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { wordpressCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

async function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, wordpressCredential, "wordpress", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

function registerContentCrud(
  rl: RunlinePluginAPI,
  resource: string,
  plural: string,
) {
  rl.registerAction(`${resource}.create`, {
    access: "write",
    description: `Create a ${resource}`,
    inputSchema: {
      title: { type: "string", required: true },
      content: { type: "string", required: false },
      status: {
        type: "string",
        required: false,
        description: "publish, draft, pending, private",
      },
      slug: { type: "string", required: false },
    },
    async execute(input, ctx) {
      return apiRequest(ctx, "POST", plural, input as Record<string, unknown>);
    },
  });

  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource} by ID`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `${plural}/${seg((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `List ${plural}`,
    inputSchema: {
      limit: { type: "number", required: false },
      search: { type: "string", required: false },
      status: { type: "string", required: false },
      orderby: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.per_page = p.limit;
      if (p.search) qs.search = p.search;
      if (p.status) qs.status = p.status;
      if (p.orderby) qs.orderby = p.orderby;
      return apiRequest(ctx, "GET", plural, undefined, qs);
    },
  });

  rl.registerAction(`${resource}.update`, {
    access: "write",
    description: `Update a ${resource}`,
    inputSchema: {
      id: { type: "string", required: true },
      title: { type: "string", required: false },
      content: { type: "string", required: false },
      status: { type: "string", required: false },
      slug: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", `${plural}/${seg(id)}`, fields);
    },
  });

  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: {
      id: { type: "string", required: true },
      force: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.force) qs.force = "true";
      return apiRequest(ctx, "DELETE", `${plural}/${seg(p.id)}`, undefined, qs);
    },
  });
}

export default function wordpress(rl: RunlinePluginAPI) {
  rl.setName("wordpress");
  rl.setVersion("0.1.0");
  rl.setCredential(wordpressCredential);
  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "WordPress site URL",
      env: "WORDPRESS_URL",
    },
    username: {
      type: "string",
      required: true,
      description: "WordPress username",
      env: "WORDPRESS_USERNAME",
    },
    password: {
      type: "string",
      required: true,
      description: "WordPress application password",
      env: "WORDPRESS_PASSWORD",
    },
  });

  registerContentCrud(rl, "post", "posts");
  registerContentCrud(rl, "page", "pages");

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.create", {
    access: "write",
    description: "Create a user",
    inputSchema: {
      username: { type: "string", required: true },
      email: { type: "string", required: true },
      password: { type: "string", required: true },
      name: { type: "string", required: false },
    },
    async execute(input, ctx) {
      return apiRequest(ctx, "POST", "users", input as Record<string, unknown>);
    },
  });

  rl.registerAction("user.get", {
    access: "read",
    description: "Get a user by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `users/${seg((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction("user.list", {
    access: "read",
    description: "List users",
    inputSchema: {
      limit: { type: "number", required: false },
      search: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.per_page = p.limit;
      if (p.search) qs.search = p.search;
      return apiRequest(ctx, "GET", "users", undefined, qs);
    },
  });

  rl.registerAction("user.update", {
    access: "write",
    description: "Update a user",
    inputSchema: {
      id: { type: "string", required: true },
      name: { type: "string", required: false },
      email: { type: "string", required: false },
      description: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", `users/${seg(id)}`, fields);
    },
  });

  rl.registerAction("user.delete", {
    access: "write",
    description: "Delete the current user",
    inputSchema: {
      reassign: {
        type: "string",
        required: true,
        description: "User ID to reassign content to",
      },
    },
    async execute(input, ctx) {
      return apiRequest(ctx, "DELETE", "users/me", undefined, {
        reassign: (input as Record<string, unknown>).reassign,
        force: "true",
      });
    },
  });
}
