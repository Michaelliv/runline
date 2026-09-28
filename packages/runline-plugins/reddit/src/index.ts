import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { redditCredential } from "./credentials.js";

/** A Reddit call; every answer is asked for as JSON (`api_type=json`). */
function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, redditCredential, "reddit", {
    target: "api",
    path: endpoint,
    method,
    query: { ...query, api_type: "json" },
    headers: { "User-Agent": "runline" },
  });
}

export default function reddit(rl: RunlinePluginAPI) {
  rl.setName("reddit");
  rl.setVersion("0.1.0");
  rl.setCredential(redditCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: false,
      description:
        "Reddit OAuth2 access token (required for post/comment/profile actions)",
      env: "REDDIT_ACCESS_TOKEN",
    },
  });

  // ── Post ────────────────────────────────────────────

  rl.registerAction("post.create", {
    access: "write",
    description: "Submit a new post to a subreddit (requires auth)",
    inputSchema: {
      subreddit: { type: "string", required: true },
      title: { type: "string", required: true },
      kind: {
        type: "string",
        required: true,
        description: "self (text) or link",
      },
      text: {
        type: "string",
        required: false,
        description: "Post body (for self posts)",
      },
      url: {
        type: "string",
        required: false,
        description: "URL (for link posts)",
      },
      resubmit: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        title: p.title,
        sr: p.subreddit,
        kind: p.kind,
      };
      if (p.kind === "self") qs.text = p.text;
      else qs.url = p.url;
      if (p.resubmit) qs.resubmit = "true";
      const data = (await apiRequest(ctx, "POST", "api/submit", qs)) as Record<
        string,
        unknown
      >;
      return (data.json as Record<string, unknown>)?.data;
    },
  });

  rl.registerAction("post.get", {
    access: "read",
    description: "Get a post by ID",
    inputSchema: {
      subreddit: { type: "string", required: true },
      postId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { subreddit, postId } = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "GET",
        `r/${pathSegment(subreddit)}/comments/${pathSegment(`${postId}.json`)}`,
      )) as Array<Record<string, unknown>>;
      const listing = data[0] as Record<string, unknown>;
      const ld = listing.data as Record<string, unknown>;
      const children = ld.children as Array<Record<string, unknown>>;
      return children[0]?.data;
    },
  });

  rl.registerAction("post.list", {
    access: "read",
    description:
      "List posts from a subreddit (no auth required for public subreddits)",
    inputSchema: {
      subreddit: { type: "string", required: true },
      category: {
        type: "string",
        required: false,
        description: "hot (default), new, rising, top, controversial",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results (default 25)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const cat = (p.category as string) ?? "";
      const endpoint = cat
        ? `r/${pathSegment(p.subreddit)}/${pathSegment(`${cat}.json`)}`
        : `r/${pathSegment(`${p.subreddit}.json`)}`;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      const data = (await apiRequest(ctx, "GET", endpoint, qs)) as Record<
        string,
        unknown
      >;
      const ld = data.data as Record<string, unknown>;
      return (ld.children as Array<Record<string, unknown>>).map((c) => c.data);
    },
  });

  rl.registerAction("post.delete", {
    access: "write",
    description: "Delete a post (requires auth)",
    inputSchema: { postId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { postId } = input as Record<string, unknown>;
      await apiRequest(ctx, "POST", "api/del", {
        id: `t3_${postId}`,
      });
      return { success: true };
    },
  });

  rl.registerAction("post.search", {
    access: "read",
    description: "Search posts",
    inputSchema: {
      keyword: { type: "string", required: true },
      subreddit: {
        type: "string",
        required: false,
        description: "Limit search to subreddit",
      },
      sort: {
        type: "string",
        required: false,
        description: "relevance, hot, top, new, comments",
      },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { q: p.keyword };
      if (p.sort) qs.sort = p.sort;
      if (p.limit) qs.limit = p.limit;
      const endpoint = p.subreddit
        ? `r/${pathSegment(p.subreddit)}/search.json`
        : "search.json";
      if (p.subreddit) qs.restrict_sr = "true";
      const data = (await apiRequest(ctx, "GET", endpoint, qs)) as Record<
        string,
        unknown
      >;
      const ld = data.data as Record<string, unknown>;
      return (ld.children as Array<Record<string, unknown>>).map((c) => c.data);
    },
  });

  // ── Comment ─────────────────────────────────────────

  rl.registerAction("comment.create", {
    access: "write",
    description: "Add a comment to a post (requires auth)",
    inputSchema: {
      postId: { type: "string", required: true },
      text: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { postId, text } = input as Record<string, unknown>;
      const data = (await apiRequest(ctx, "POST", "api/comment", {
        thing_id: `t3_${postId}`,
        text,
      })) as Record<string, unknown>;
      const json = data.json as Record<string, unknown>;
      const jd = json.data as Record<string, unknown>;
      const things = jd.things as Array<Record<string, unknown>>;
      return things[0]?.data;
    },
  });

  rl.registerAction("comment.reply", {
    access: "write",
    description: "Reply to a comment (requires auth)",
    inputSchema: {
      commentId: { type: "string", required: true },
      text: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { commentId, text } = input as Record<string, unknown>;
      const data = (await apiRequest(ctx, "POST", "api/comment", {
        thing_id: `t1_${commentId}`,
        text,
      })) as Record<string, unknown>;
      const json = data.json as Record<string, unknown>;
      const jd = json.data as Record<string, unknown>;
      const things = jd.things as Array<Record<string, unknown>>;
      return things[0]?.data;
    },
  });

  rl.registerAction("comment.delete", {
    access: "write",
    description: "Delete a comment (requires auth)",
    inputSchema: { commentId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { commentId } = input as Record<string, unknown>;
      await apiRequest(ctx, "POST", "api/del", {
        id: `t1_${commentId}`,
      });
      return { success: true };
    },
  });

  // ── Subreddit ───────────────────────────────────────

  rl.registerAction("subreddit.get", {
    access: "read",
    description: "Get subreddit info or rules (no auth required)",
    inputSchema: {
      subreddit: { type: "string", required: true },
      content: {
        type: "string",
        required: false,
        description: "about (default) or rules",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const content = (p.content as string) ?? "about";
      const data = (await apiRequest(
        ctx,
        "GET",
        `r/${pathSegment(p.subreddit)}/about/${pathSegment(`${content}.json`)}`,
      )) as Record<string, unknown>;
      if (content === "rules") return (data as Record<string, unknown>).rules;
      return data.data;
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.get", {
    access: "read",
    description: "Get user profile info (no auth required)",
    inputSchema: { username: { type: "string", required: true } },
    async execute(input, ctx) {
      const { username } = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "GET",
        `user/${pathSegment(username)}/about.json`,
      )) as Record<string, unknown>;
      return data.data;
    },
  });
}
