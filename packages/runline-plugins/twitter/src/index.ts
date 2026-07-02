import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.twitter.com/2";

async function api(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
  fullOutput = false,
): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok)
    throw new Error(`Twitter error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as Record<string, unknown>;
  return fullOutput ? json : json.data;
}

async function paginate(
  token: string,
  endpoint: string,
  qs: Record<string, unknown> = {},
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let nextToken: string | undefined;
  qs.max_results = limit && limit < 100 ? limit : 10;
  do {
    if (nextToken) qs.next_token = nextToken;
    const res = (await api(
      token,
      "GET",
      endpoint,
      undefined,
      { ...qs },
      true,
    )) as Record<string, unknown>;
    const data = res.data as unknown[] | undefined;
    if (data) results.push(...data);
    nextToken = (res.meta as Record<string, unknown>)?.next_token as
      | string
      | undefined;
    if (limit && results.length >= limit) {
      return results.slice(0, limit);
    }
  } while (nextToken);
  return results;
}

export default function twitter(rl: RunlinePluginAPI) {
  rl.setName("twitter");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    bearerToken: {
      type: "string",
      required: true,
      description: "OAuth2 Bearer token for Twitter/X API v2",
      env: "TWITTER_BEARER_TOKEN",
    },
  });
  const t = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.bearerToken as string;

  // ── Tweet ───────────────────────────────────────────

  rl.registerAction("tweet.create", {
    access: "write",
    description: "Create a tweet (post, quote, or reply)",
    inputSchema: {
      text: { type: "string", required: true },
      quoteTweetId: {
        type: "string",
        required: false,
        description: "Tweet ID to quote",
      },
      replyToTweetId: {
        type: "string",
        required: false,
        description: "Tweet ID to reply to",
      },
      mediaId: { type: "string", required: false },
      placeId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { text: p.text };
      if (p.quoteTweetId) body.quote_tweet_id = p.quoteTweetId;
      if (p.replyToTweetId)
        body.reply = { in_reply_to_tweet_id: p.replyToTweetId };
      if (p.mediaId) body.media = { media_ids: [p.mediaId] };
      if (p.placeId) body.geo = { place_id: p.placeId };
      return api(t(ctx), "POST", "/tweets", body);
    },
  });

  rl.registerAction("tweet.delete", {
    access: "write",
    description: "Delete a tweet",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        t(ctx),
        "DELETE",
        `/tweets/${(input as Record<string, unknown>).id}`,
      );
    },
  });

  rl.registerAction("tweet.like", {
    access: "write",
    description: "Like a tweet (requires user context)",
    inputSchema: { tweetId: { type: "string", required: true } },
    async execute(input, ctx) {
      const user = (await api(t(ctx), "GET", "/users/me")) as Record<
        string,
        unknown
      >;
      return api(t(ctx), "POST", `/users/${user.id}/likes`, {
        tweet_id: (input as Record<string, unknown>).tweetId,
      });
    },
  });

  rl.registerAction("tweet.retweet", {
    access: "write",
    description: "Retweet a tweet (requires user context)",
    inputSchema: { tweetId: { type: "string", required: true } },
    async execute(input, ctx) {
      const user = (await api(t(ctx), "GET", "/users/me")) as Record<
        string,
        unknown
      >;
      return api(t(ctx), "POST", `/users/${user.id}/retweets`, {
        tweet_id: (input as Record<string, unknown>).tweetId,
      });
    },
  });

  rl.registerAction("tweet.search", {
    access: "read",
    description: "Search recent tweets (last 7 days)",
    inputSchema: {
      query: { type: "string", required: true },
      limit: {
        type: "number",
        required: false,
        description: "Max results (default all)",
      },
      sortOrder: {
        type: "string",
        required: false,
        description: "recency or relevancy",
      },
      startTime: {
        type: "string",
        required: false,
        description: "ISO datetime",
      },
      endTime: { type: "string", required: false, description: "ISO datetime" },
      tweetFields: {
        type: "string",
        required: false,
        description:
          "Comma-separated fields like author_id,created_at,public_metrics",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { query: p.query };
      if (p.sortOrder) qs.sort_order = p.sortOrder;
      if (p.startTime) qs.start_time = p.startTime;
      if (p.endTime) qs.end_time = p.endTime;
      if (p.tweetFields) qs["tweet.fields"] = p.tweetFields;
      const limit = p.limit as number | undefined;
      if (limit) {
        return paginate(t(ctx), "/tweets/search/recent", qs, limit);
      }
      return paginate(t(ctx), "/tweets/search/recent", qs);
    },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.get", {
    access: "read",
    description: "Get a user by username or ID",
    inputSchema: {
      username: {
        type: "string",
        required: false,
        description: "Username (without @)",
      },
      id: { type: "string", required: false, description: "User ID" },
      me: {
        type: "boolean",
        required: false,
        description: "Get the authenticated user",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      if (p.me) return api(t(ctx), "GET", "/users/me");
      if (p.username) {
        const name = (p.username as string).replace(/^@/, "");
        return api(t(ctx), "GET", `/users/by/username/${name}`);
      }
      if (p.id) return api(t(ctx), "GET", `/users/${p.id}`);
      throw new Error("Provide username, id, or set me=true");
    },
  });

  // ── List ────────────────────────────────────────────

  rl.registerAction("list.addMember", {
    access: "write",
    description: "Add a user to a list",
    inputSchema: {
      listId: { type: "string", required: true },
      userId: { type: "string", required: true, description: "User ID to add" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(t(ctx), "POST", `/lists/${p.listId}/members`, {
        user_id: p.userId,
      });
    },
  });

  // ── Direct Message ──────────────────────────────────

  rl.registerAction("dm.create", {
    access: "write",
    description: "Send a direct message to a user",
    inputSchema: {
      userId: {
        type: "string",
        required: true,
        description: "Recipient user ID",
      },
      text: { type: "string", required: true },
      mediaId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { text: p.text };
      if (p.mediaId) body.attachments = [{ media_id: p.mediaId }];
      return api(
        t(ctx),
        "POST",
        `/dm_conversations/with/${p.userId}/messages`,
        body,
      );
    },
  });
}
