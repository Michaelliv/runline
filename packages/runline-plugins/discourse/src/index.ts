import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { discourseCredential } from "./credentials.js";

function req(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
) {
  // Public companion header naming the user the admin key acts as.
  const apiUsername = (ctx.connection.config.apiUsername as string) ?? "system";
  return credentialJson(ctx, discourseCredential, "discourse", {
    target: "api",
    path: endpoint,
    method,
    query: qs,
    headers: { "Api-Username": apiUsername },
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
}

export default function discourse(rl: RunlinePluginAPI) {
  rl.setName("discourse");
  rl.setVersion("0.1.0");
  rl.setCredential(discourseCredential);

  rl.setConnectionSchema({
    host: {
      type: "string",
      required: true,
      description: "Discourse instance URL (e.g. https://forum.example.com)",
      env: "DISCOURSE_HOST",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "Discourse API key",
      env: "DISCOURSE_API_KEY",
    },
    apiUsername: {
      type: "string",
      required: false,
      description: "API username (default: system)",
      env: "DISCOURSE_API_USERNAME",
      default: "system",
    },
  });

  // ── Category ────────────────────────────────────────

  rl.registerAction("category.create", {
    access: "write",
    description: "Create a category",
    inputSchema: {
      name: { type: "string", required: true, description: "Category name" },
      color: {
        type: "string",
        required: true,
        description: "Hex color (e.g. 0088CC)",
      },
      textColor: {
        type: "string",
        required: true,
        description: "Text hex color (e.g. FFFFFF)",
      },
    },
    async execute(input, ctx) {
      const { name, color, textColor } = input as Record<string, unknown>;
      const data = (await req(ctx, "POST", "categories.json", {
        name,
        color,
        text_color: textColor,
      })) as Record<string, unknown>;
      return data.category;
    },
  });

  rl.registerAction("category.list", {
    access: "read",
    description: "List all categories",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await req(ctx, "GET", "categories.json")) as Record<
        string,
        unknown
      >;
      const list = (data.category_list as Record<string, unknown>)
        .categories as unknown[];
      if (limit) return list.slice(0, limit);
      return list;
    },
  });

  rl.registerAction("category.update", {
    access: "write",
    description: "Update a category",
    inputSchema: {
      categoryId: {
        type: "string",
        required: true,
        description: "Category ID",
      },
      name: { type: "string", required: true, description: "New name" },
      color: { type: "string", required: false, description: "New hex color" },
      textColor: {
        type: "string",
        required: false,
        description: "New text color",
      },
    },
    async execute(input, ctx) {
      const { categoryId, name, color, textColor } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { name };
      if (color) body.color = color;
      if (textColor) body.text_color = textColor;
      const data = (await req(
        ctx,
        "PUT",
        `categories/${pathSegment(categoryId)}.json`,
        body,
      )) as Record<string, unknown>;
      return data.category;
    },
  });

  // ── Group ───────────────────────────────────────────

  rl.registerAction("group.create", {
    access: "write",
    description: "Create a group",
    inputSchema: {
      name: { type: "string", required: true, description: "Group name" },
    },
    async execute(input, ctx) {
      const { name } = input as { name: string };
      const data = (await req(ctx, "POST", "admin/groups.json", {
        group: { name },
      })) as Record<string, unknown>;
      return data.basic_group;
    },
  });

  rl.registerAction("group.get", {
    access: "read",
    description: "Get a group by name",
    inputSchema: {
      name: { type: "string", required: true, description: "Group name" },
    },
    async execute(input, ctx) {
      const { name } = input as { name: string };
      const data = (await req(
        ctx,
        "GET",
        `groups/${pathSegment(name)}`,
      )) as Record<string, unknown>;
      return data.group;
    },
  });

  rl.registerAction("group.list", {
    access: "read",
    description: "List all groups",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await req(ctx, "GET", "groups.json")) as Record<
        string,
        unknown
      >;
      const groups = data.groups as unknown[];
      if (limit) return groups.slice(0, limit);
      return groups;
    },
  });

  rl.registerAction("group.update", {
    access: "write",
    description: "Update a group",
    inputSchema: {
      groupId: { type: "string", required: true, description: "Group ID" },
      name: { type: "string", required: true, description: "New group name" },
    },
    async execute(input, ctx) {
      const { groupId, name } = input as { groupId: string; name: string };
      return req(ctx, "PUT", `groups/${pathSegment(groupId)}.json`, {
        group: { name },
      });
    },
  });

  // ── Post ────────────────────────────────────────────

  rl.registerAction("post.create", {
    access: "write",
    description: "Create a post (new topic or reply)",
    inputSchema: {
      title: {
        type: "string",
        required: false,
        description: "Topic title (required for new topics)",
      },
      content: {
        type: "string",
        required: true,
        description: "Post content (raw markdown)",
      },
      categoryId: {
        type: "number",
        required: false,
        description: "Category ID (for new topics)",
      },
      topicId: {
        type: "number",
        required: false,
        description: "Topic ID (for replies)",
      },
      replyToPostNumber: {
        type: "number",
        required: false,
        description: "Post number to reply to",
      },
    },
    async execute(input, ctx) {
      const { title, content, categoryId, topicId, replyToPostNumber } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = { raw: content };
      if (title) body.title = title;
      if (categoryId) body.category = categoryId;
      if (topicId) body.topic_id = topicId;
      if (replyToPostNumber) body.reply_to_post_number = replyToPostNumber;
      return req(ctx, "POST", "posts.json", body);
    },
  });

  rl.registerAction("post.get", {
    access: "read",
    description: "Get a post by ID",
    inputSchema: {
      postId: { type: "string", required: true, description: "Post ID" },
    },
    async execute(input, ctx) {
      return req(
        ctx,
        "GET",
        `posts/${pathSegment((input as { postId: string }).postId)}`,
      );
    },
  });

  rl.registerAction("post.list", {
    access: "read",
    description: "List latest posts",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await req(ctx, "GET", "posts.json")) as Record<
        string,
        unknown
      >;
      const posts = data.latest_posts as unknown[];
      if (limit) return posts.slice(0, limit);
      return posts;
    },
  });

  rl.registerAction("post.update", {
    access: "write",
    description: "Update a post",
    inputSchema: {
      postId: { type: "string", required: true, description: "Post ID" },
      content: {
        type: "string",
        required: true,
        description: "New content (raw markdown)",
      },
      editReason: {
        type: "string",
        required: false,
        description: "Reason for edit",
      },
    },
    async execute(input, ctx) {
      const { postId, content, editReason } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { raw: content };
      if (editReason) body.edit_reason = editReason;
      const data = (await req(
        ctx,
        "PUT",
        `posts/${pathSegment(postId)}.json`,
        body,
      )) as Record<string, unknown>;
      return data.post;
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.create", {
    access: "write",
    description: "Create a user",
    inputSchema: {
      name: { type: "string", required: true, description: "Full name" },
      email: { type: "string", required: true, description: "Email address" },
      username: { type: "string", required: true, description: "Username" },
      password: { type: "string", required: true, description: "Password" },
      active: {
        type: "boolean",
        required: false,
        description: "Create as active (default: false)",
      },
    },
    async execute(input, ctx) {
      const { name, email, username, password, active } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { name, email, username, password };
      if (active !== undefined) body.active = active;
      return req(ctx, "POST", "users.json", body);
    },
  });

  rl.registerAction("user.get", {
    access: "read",
    description: "Get a user by username or external ID",
    inputSchema: {
      username: { type: "string", required: false, description: "Username" },
      externalId: {
        type: "string",
        required: false,
        description: "External (SSO) ID",
      },
    },
    async execute(input, ctx) {
      const { username, externalId } = (input ?? {}) as Record<string, unknown>;
      if (externalId)
        return req(ctx, "GET", `u/by-external/${pathSegment(externalId)}.json`);
      if (username) return req(ctx, "GET", `users/${pathSegment(username)}`);
      throw new Error("Provide either username or externalId");
    },
  });

  rl.registerAction("user.list", {
    access: "read",
    description: "List users (admin)",
    inputSchema: {
      flag: {
        type: "string",
        required: false,
        description: "Filter: active (default), new, staff, suspended, blocked",
      },
      limit: { type: "number", required: false, description: "Max results" },
      order: { type: "string", required: false, description: "Order by field" },
      asc: { type: "boolean", required: false, description: "Ascending order" },
      showEmails: {
        type: "boolean",
        required: false,
        description: "Include email addresses",
      },
    },
    async execute(input, ctx) {
      const {
        flag = "active",
        limit,
        order,
        asc,
        showEmails,
      } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (order) qs.order = order;
      if (asc !== undefined) qs.asc = asc;
      if (showEmails) qs.show_emails = true;
      let data = (await req(
        ctx,
        "GET",
        `admin/users/list/${pathSegment(flag)}.json`,
        undefined,
        qs,
      )) as unknown[];
      if (limit) data = data.slice(0, limit as number);
      return data;
    },
  });

  // ── User Group ──────────────────────────────────────

  rl.registerAction("userGroup.add", {
    access: "write",
    description: "Add users to a group",
    inputSchema: {
      groupId: { type: "string", required: true, description: "Group ID" },
      usernames: {
        type: "string",
        required: true,
        description: "Comma-separated usernames",
      },
    },
    async execute(input, ctx) {
      const { groupId, usernames } = input as {
        groupId: string;
        usernames: string;
      };
      return req(ctx, "PUT", `groups/${pathSegment(groupId)}/members.json`, {
        usernames,
      });
    },
  });

  rl.registerAction("userGroup.remove", {
    access: "write",
    description: "Remove users from a group",
    inputSchema: {
      groupId: { type: "string", required: true, description: "Group ID" },
      usernames: {
        type: "string",
        required: true,
        description: "Comma-separated usernames",
      },
    },
    async execute(input, ctx) {
      const { groupId, usernames } = input as {
        groupId: string;
        usernames: string;
      };
      return req(ctx, "DELETE", `groups/${pathSegment(groupId)}/members.json`, {
        usernames,
      });
    },
  });
}
