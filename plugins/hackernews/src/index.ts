import type { RunlinePluginAPI } from "runline";

const ALGOLIA_URL = "http://hn.algolia.com/api/v1";
const FIREBASE_URL = "https://hacker-news.firebaseio.com/v0";

async function algoliaRequest(endpoint: string, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${ALGOLIA_URL}/${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HN API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function firebaseRequest(endpoint: string): Promise<unknown> {
  const res = await fetch(`${FIREBASE_URL}/${endpoint}.json`);
  if (!res.ok) throw new Error(`HN Firebase API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function hackernews(rl: RunlinePluginAPI) {
  rl.setName("hackernews");
  rl.setVersion("0.1.0");

  // No auth needed
  rl.setConnectionSchema({});

  rl.registerAction("article.get", {
    description: "Get a Hacker News article/item by ID",
    inputSchema: { articleId: { type: "string", required: true, description: "Item ID" } },
    async execute(input) {
      return firebaseRequest(`item/${(input as { articleId: string }).articleId}`);
    },
  });

  rl.registerAction("article.search", {
    description: "Search Hacker News articles",
    inputSchema: {
      query: { type: "string", required: true, description: "Search query" },
      tags: { type: "string", required: false, description: "Filter tags: story, comment, ask_hn, show_hn, poll, front_page" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input) {
      const { query, tags, limit } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { query };
      if (tags) qs.tags = tags;
      if (limit) qs.hitsPerPage = limit;
      const data = (await algoliaRequest("search", qs)) as Record<string, unknown>;
      return data.hits;
    },
  });

  rl.registerAction("user.get", {
    description: "Get a Hacker News user by username",
    inputSchema: { username: { type: "string", required: true, description: "Username" } },
    async execute(input) {
      return firebaseRequest(`user/${(input as { username: string }).username}`);
    },
  });

  rl.registerAction("all.top", {
    description: "Get top stories",
    inputSchema: { limit: { type: "number", required: false, description: "Max results (default: 30)" } },
    async execute(input) {
      const { limit = 30 } = (input ?? {}) as { limit?: number };
      const ids = (await firebaseRequest("topstories")) as number[];
      const items = await Promise.all(ids.slice(0, limit).map((id) => firebaseRequest(`item/${id}`)));
      return items;
    },
  });

  rl.registerAction("all.new", {
    description: "Get newest stories",
    inputSchema: { limit: { type: "number", required: false, description: "Max results (default: 30)" } },
    async execute(input) {
      const { limit = 30 } = (input ?? {}) as { limit?: number };
      const ids = (await firebaseRequest("newstories")) as number[];
      const items = await Promise.all(ids.slice(0, limit).map((id) => firebaseRequest(`item/${id}`)));
      return items;
    },
  });

  rl.registerAction("all.best", {
    description: "Get best stories",
    inputSchema: { limit: { type: "number", required: false, description: "Max results (default: 30)" } },
    async execute(input) {
      const { limit = 30 } = (input ?? {}) as { limit?: number };
      const ids = (await firebaseRequest("beststories")) as number[];
      const items = await Promise.all(ids.slice(0, limit).map((id) => firebaseRequest(`item/${id}`)));
      return items;
    },
  });
}
