import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  token: string | undefined,
  method: string,
  endpoint: string,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const base = token ? "https://oauth.reddit.com" : "https://www.reddit.com";
  const url = new URL(`${base}/${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  url.searchParams.set("api_type", "json");
  const headers: Record<string, string> = { "User-Agent": "runline" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  const res = await fetch(url.toString(), init);
  if (!res.ok)
    throw new Error(`Reddit error ${res.status}: ${await res.text()}`);
  return res.json();
}

function getToken(ctx: {
  connection: { config: Record<string, unknown> };
}): string | undefined {
  return ctx.connection.config.accessToken as string | undefined;
}

export default function reddit(rl: RunlinePluginAPI) {
  rl.setName("reddit");
  rl.setVersion("0.1.0");

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
      const data = (await apiRequest(
        getToken(ctx),
        "POST",
        "api/submit",
        qs,
      )) as Record<string, unknown>;
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
        getToken(ctx),
        "GET",
        `r/${subreddit}/comments/${postId}.json`,
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
        ? `r/${p.subreddit}/${cat}.json`
        : `r/${p.subreddit}.json`;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      const data = (await apiRequest(
        getToken(ctx),
        "GET",
        endpoint,
        qs,
      )) as Record<string, unknown>;
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
      await apiRequest(getToken(ctx), "POST", "api/del", {
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
        ? `r/${p.subreddit}/search.json`
        : "search.json";
      if (p.subreddit) qs.restrict_sr = "true";
      const data = (await apiRequest(
        getToken(ctx),
        "GET",
        endpoint,
        qs,
      )) as Record<string, unknown>;
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
      const data = (await apiRequest(getToken(ctx), "POST", "api/comment", {
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
      const data = (await apiRequest(getToken(ctx), "POST", "api/comment", {
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
      await apiRequest(getToken(ctx), "POST", "api/del", {
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
        getToken(ctx),
        "GET",
        `r/${p.subreddit}/about/${content}.json`,
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
        getToken(ctx),
        "GET",
        `user/${username}/about.json`,
      )) as Record<string, unknown>;
      return data.data;
    },
  });
}
