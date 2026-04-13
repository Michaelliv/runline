import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  host: string,
  apiKey: string,
  apiUsername: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${host}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Api-Key": apiKey,
      "Api-Username": apiUsername,
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Discourse API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const cfg = ctx.connection.config;
  return {
    host: (cfg.host as string).replace(/\/$/, ""),
    apiKey: cfg.apiKey as string,
    apiUsername: (cfg.apiUsername as string) ?? "system",
  };
}

function req(ctx: { connection: { config: Record<string, unknown> } }, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>) {
  const { host, apiKey, apiUsername } = getConn(ctx);
  return apiRequest(host, apiKey, apiUsername, method, endpoint, body, qs);
}

export default function discourse(rl: RunlinePluginAPI) {
  rl.setName("discourse");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    host: { type: "string", required: true, description: "Discourse instance URL (e.g. https://forum.example.com)", env: "DISCOURSE_HOST" },
    apiKey: { type: "string", required: true, description: "Discourse API key", env: "DISCOURSE_API_KEY" },
    apiUsername: { type: "string", required: false, description: "API username (default: system)", env: "DISCOURSE_API_USERNAME", default: "system" },
  });

  // ── Category ────────────────────────────────────────

  rl.registerAction("category.create", {
    description: "Create a category",
    inputSchema: {
      name: { type: "string", required: true, description: "Category name" },
      color: { type: "string", required: true, description: "Hex color (e.g. 0088CC)" },
      textColor: { type: "string", required: true, description: "Text hex color (e.g. FFFFFF)" },
    },
    async execute(input, ctx) {
      const { name, color, textColor } = input as Record<string, unknown>;
      const data = (await req(ctx, "POST", "/categories.json", { name, color, text_color: textColor })) as Record<string, unknown>;
      return data.category;
    },
  });

  rl.registerAction("category.list", {
    description: "List all categories",
    inputSchema: { limit: { type: "number", required: false, description: "Max results" } },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await req(ctx, "GET", "/categories.json")) as Record<string, unknown>;
      const list = (data.category_list as Record<string, unknown>).categories as unknown[];
      if (limit) return list.slice(0, limit);
      return list;
    },
  });

  rl.registerAction("category.update", {
    description: "Update a category",
    inputSchema: {
      categoryId: { type: "string", required: true, description: "Category ID" },
      name: { type: "string", required: true, description: "New name" },
      color: { type: "string", required: false, description: "New hex color" },
      textColor: { type: "string", required: false, description: "New text color" },
    },
    async execute(input, ctx) {
      const { categoryId, name, color, textColor } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name };
      if (color) body.color = color;
      if (textColor) body.text_color = textColor;
      const data = (await req(ctx, "PUT", `/categories/${categoryId}.json`, body)) as Record<string, unknown>;
      return data.category;
    },
  });

  // ── Group ───────────────────────────────────────────

  rl.registerAction("group.create", {
    description: "Create a group",
    inputSchema: { name: { type: "string", required: true, description: "Group name" } },
    async execute(input, ctx) {
      const { name } = input as { name: string };
      const data = (await req(ctx, "POST", "/admin/groups.json", { group: { name } })) as Record<string, unknown>;
      return data.basic_group;
    },
  });

  rl.registerAction("group.get", {
    description: "Get a group by name",
    inputSchema: { name: { type: "string", required: true, description: "Group name" } },
    async execute(input, ctx) {
      const { name } = input as { name: string };
      const data = (await req(ctx, "GET", `/groups/${name}`)) as Record<string, unknown>;
      return data.group;
    },
  });

  rl.registerAction("group.list", {
    description: "List all groups",
    inputSchema: { limit: { type: "number", required: false, description: "Max results" } },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await req(ctx, "GET", "/groups.json")) as Record<string, unknown>;
      const groups = data.groups as unknown[];
      if (limit) return groups.slice(0, limit);
      return groups;
    },
  });

  rl.registerAction("group.update", {
    description: "Update a group",
    inputSchema: {
      groupId: { type: "string", required: true, description: "Group ID" },
      name: { type: "string", required: true, description: "New group name" },
    },
    async execute(input, ctx) {
      const { groupId, name } = input as { groupId: string; name: string };
      return req(ctx, "PUT", `/groups/${groupId}.json`, { group: { name } });
    },
  });

  // ── Post ────────────────────────────────────────────

  rl.registerAction("post.create", {
    description: "Create a post (new topic or reply)",
    inputSchema: {
      title: { type: "string", required: false, description: "Topic title (required for new topics)" },
      content: { type: "string", required: true, description: "Post content (raw markdown)" },
      categoryId: { type: "number", required: false, description: "Category ID (for new topics)" },
      topicId: { type: "number", required: false, description: "Topic ID (for replies)" },
      replyToPostNumber: { type: "number", required: false, description: "Post number to reply to" },
    },
    async execute(input, ctx) {
      const { title, content, categoryId, topicId, replyToPostNumber } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { raw: content };
      if (title) body.title = title;
      if (categoryId) body.category = categoryId;
      if (topicId) body.topic_id = topicId;
      if (replyToPostNumber) body.reply_to_post_number = replyToPostNumber;
      return req(ctx, "POST", "/posts.json", body);
    },
  });

  rl.registerAction("post.get", {
    description: "Get a post by ID",
    inputSchema: { postId: { type: "string", required: true, description: "Post ID" } },
    async execute(input, ctx) {
      return req(ctx, "GET", `/posts/${(input as { postId: string }).postId}`);
    },
  });

  rl.registerAction("post.list", {
    description: "List latest posts",
    inputSchema: { limit: { type: "number", required: false, description: "Max results" } },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await req(ctx, "GET", "/posts.json")) as Record<string, unknown>;
      const posts = data.latest_posts as unknown[];
      if (limit) return posts.slice(0, limit);
      return posts;
    },
  });

  rl.registerAction("post.update", {
    description: "Update a post",
    inputSchema: {
      postId: { type: "string", required: true, description: "Post ID" },
      content: { type: "string", required: true, description: "New content (raw markdown)" },
      editReason: { type: "string", required: false, description: "Reason for edit" },
    },
    async execute(input, ctx) {
      const { postId, content, editReason } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { raw: content };
      if (editReason) body.edit_reason = editReason;
      const data = (await req(ctx, "PUT", `/posts/${postId}.json`, body)) as Record<string, unknown>;
      return data.post;
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.create", {
    description: "Create a user",
    inputSchema: {
      name: { type: "string", required: true, description: "Full name" },
      email: { type: "string", required: true, description: "Email address" },
      username: { type: "string", required: true, description: "Username" },
      password: { type: "string", required: true, description: "Password" },
      active: { type: "boolean", required: false, description: "Create as active (default: false)" },
    },
    async execute(input, ctx) {
      const { name, email, username, password, active } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name, email, username, password };
      if (active !== undefined) body.active = active;
      return req(ctx, "POST", "/users.json", body);
    },
  });

  rl.registerAction("user.get", {
    description: "Get a user by username or external ID",
    inputSchema: {
      username: { type: "string", required: false, description: "Username" },
      externalId: { type: "string", required: false, description: "External (SSO) ID" },
    },
    async execute(input, ctx) {
      const { username, externalId } = (input ?? {}) as Record<string, unknown>;
      if (externalId) return req(ctx, "GET", `/u/by-external/${externalId}.json`);
      if (username) return req(ctx, "GET", `/users/${username}`);
      throw new Error("Provide either username or externalId");
    },
  });

  rl.registerAction("user.list", {
    description: "List users (admin)",
    inputSchema: {
      flag: { type: "string", required: false, description: "Filter: active (default), new, staff, suspended, blocked" },
      limit: { type: "number", required: false, description: "Max results" },
      order: { type: "string", required: false, description: "Order by field" },
      asc: { type: "boolean", required: false, description: "Ascending order" },
      showEmails: { type: "boolean", required: false, description: "Include email addresses" },
    },
    async execute(input, ctx) {
      const { flag = "active", limit, order, asc, showEmails } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (order) qs.order = order;
      if (asc !== undefined) qs.asc = asc;
      if (showEmails) qs.show_emails = true;
      let data = (await req(ctx, "GET", `/admin/users/list/${flag}.json`, undefined, qs)) as unknown[];
      if (limit) data = data.slice(0, limit as number);
      return data;
    },
  });

  // ── User Group ──────────────────────────────────────

  rl.registerAction("userGroup.add", {
    description: "Add users to a group",
    inputSchema: {
      groupId: { type: "string", required: true, description: "Group ID" },
      usernames: { type: "string", required: true, description: "Comma-separated usernames" },
    },
    async execute(input, ctx) {
      const { groupId, usernames } = input as { groupId: string; usernames: string };
      return req(ctx, "PUT", `/groups/${groupId}/members.json`, { usernames });
    },
  });

  rl.registerAction("userGroup.remove", {
    description: "Remove users from a group",
    inputSchema: {
      groupId: { type: "string", required: true, description: "Group ID" },
      usernames: { type: "string", required: true, description: "Comma-separated usernames" },
    },
    async execute(input, ctx) {
      const { groupId, usernames } = input as { groupId: string; usernames: string };
      return req(ctx, "DELETE", `/groups/${groupId}/members.json`, { usernames });
    },
  });
}
