import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://disqus.com/api/3.0";

async function apiRequest(
  apiKey: string,
  endpoint: string,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  url.searchParams.set("api_key", apiKey);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, String(item));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Disqus API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function paginate(apiKey: string, endpoint: string, qs: Record<string, unknown>, limit?: number): Promise<unknown[]> {
  const results: unknown[] = [];
  let cursor: string | undefined;
  do {
    const q = { ...qs, limit: 100 } as Record<string, unknown>;
    if (cursor) q.cursor = cursor;
    const data = (await apiRequest(apiKey, endpoint, q)) as Record<string, unknown>;
    const items = data.response as unknown[];
    results.push(...items);
    const c = data.cursor as Record<string, unknown> | undefined;
    if (c?.more && c?.hasNext) {
      cursor = c.id as string;
    } else {
      break;
    }
    if (limit && results.length >= limit) break;
  } while (true);
  return limit ? results.slice(0, limit) : results;
}

export default function disqus(rl: RunlinePluginAPI) {
  rl.setName("disqus");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Disqus API key (access token)", env: "DISQUS_API_KEY" },
  });

  rl.registerAction("forum.get", {
    description: "Get forum details",
    inputSchema: {
      forum: { type: "string", required: true, description: "Forum short name (ID)" },
      related: { type: "array", required: false, description: "Relations to include (e.g. ['author'])" },
      attach: { type: "array", required: false, description: "Attach fields (e.g. ['counters'])" },
    },
    async execute(input, ctx) {
      const { forum, related, attach } = input as Record<string, unknown>;
      const apiKey = ctx.connection.config.apiKey as string;
      const qs: Record<string, unknown> = { forum };
      if (related) qs.related = related;
      if (attach) qs.attach = attach;
      const data = (await apiRequest(apiKey, "forums/details.json", qs)) as Record<string, unknown>;
      return data.response;
    },
  });

  rl.registerAction("forum.listPosts", {
    description: "List posts in a forum",
    inputSchema: {
      forum: { type: "string", required: true, description: "Forum short name" },
      limit: { type: "number", required: false, description: "Max results" },
      order: { type: "string", required: false, description: "Sort order: asc or desc" },
      query: { type: "string", required: false, description: "Search query" },
      since: { type: "string", required: false, description: "Filter posts since (ISO datetime or unix timestamp)" },
      related: { type: "array", required: false, description: "Relations (e.g. ['thread'])" },
      include: { type: "array", required: false, description: "Include filters (e.g. ['approved'])" },
      filters: { type: "array", required: false, description: "Post filters (e.g. ['Is_Flagged'])" },
    },
    async execute(input, ctx) {
      const { forum, limit, order, query, since, related, include, filters } = (input ?? {}) as Record<string, unknown>;
      const apiKey = ctx.connection.config.apiKey as string;
      const qs: Record<string, unknown> = { forum };
      if (order) qs.order = order;
      if (query) qs.query = query;
      if (since) qs.since = since;
      if (related) qs.related = related;
      if (include) qs.include = include;
      if (filters) qs.filters = filters;
      return paginate(apiKey, "forums/listPosts.json", qs, limit as number | undefined);
    },
  });

  rl.registerAction("forum.listCategories", {
    description: "List categories in a forum",
    inputSchema: {
      forum: { type: "string", required: true, description: "Forum short name" },
      limit: { type: "number", required: false, description: "Max results" },
      order: { type: "string", required: false, description: "Sort order: asc or desc" },
    },
    async execute(input, ctx) {
      const { forum, limit, order } = (input ?? {}) as Record<string, unknown>;
      const apiKey = ctx.connection.config.apiKey as string;
      const qs: Record<string, unknown> = { forum };
      if (order) qs.order = order;
      return paginate(apiKey, "forums/listCategories.json", qs, limit as number | undefined);
    },
  });

  rl.registerAction("forum.listThreads", {
    description: "List threads in a forum",
    inputSchema: {
      forum: { type: "string", required: true, description: "Forum short name" },
      limit: { type: "number", required: false, description: "Max results" },
      order: { type: "string", required: false, description: "Sort order: asc or desc" },
      since: { type: "string", required: false, description: "Filter since (ISO datetime or unix timestamp)" },
      related: { type: "array", required: false, description: "Relations (e.g. ['author', 'forum'])" },
      include: { type: "array", required: false, description: "Thread states (e.g. ['open', 'closed', 'killed'])" },
      thread: { type: "string", required: false, description: "Look up specific thread by ID or ident" },
    },
    async execute(input, ctx) {
      const { forum, limit, order, since, related, include, thread } = (input ?? {}) as Record<string, unknown>;
      const apiKey = ctx.connection.config.apiKey as string;
      const qs: Record<string, unknown> = { forum };
      if (order) qs.order = order;
      if (since) qs.since = since;
      if (related) qs.related = related;
      if (include) qs.include = include;
      if (thread) qs.thread = thread;
      return paginate(apiKey, "forums/listThreads.json", qs, limit as number | undefined);
    },
  });
}
