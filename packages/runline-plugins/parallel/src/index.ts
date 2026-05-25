/**
 * Parallel.ai web search/research plugin for runline.
 *
 * Wraps the Parallel Search API (https://api.parallel.ai/v1beta/search): give it
 * an objective and/or explicit queries and it returns ranked, freshly-fetched
 * web results with extracted excerpts — built for agents that need to ground an
 * answer in the live web rather than training data.
 *
 * Auth: a Parallel API key (header `x-api-key`), via the `apiKey` connection
 * field (env `PARALLEL_API_KEY`).
 *
 *   await parallel.search({ objective: "latest Israel construction permit reform" })
 *   await parallel.search({ search_queries: ["tel aviv office vacancy rate 2026"], processor: "pro" })
 */
import type { ActionContext, RunlinePluginAPI } from "runline";

const NAME = "parallel";
const DEFAULT_BASE = "https://api.parallel.ai";

type Ctx = ActionContext;

export default function parallel(rl: RunlinePluginAPI): void {
  rl.setName(NAME);
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      env: "PARALLEL_API_KEY",
      description: "Parallel.ai API key (sent as the x-api-key header). Store only in secrets.",
    },
    baseUrl: {
      type: "string",
      required: false,
      env: "PARALLEL_API_BASE",
      default: DEFAULT_BASE,
      description: "Parallel.ai API base URL.",
    },
  });

  rl.registerAction("search", {
    description:
      "Search the live web with Parallel.ai and get ranked results with extracted excerpts. Use this to ground answers in current web content (news, prices, regulations, company info) instead of stale knowledge. Provide an `objective` (natural-language goal) and/or explicit `search_queries`.",
    inputSchema: {
      objective: {
        type: "string",
        required: false,
        description: "Natural-language description of what you're trying to find. Recommended; can be used with or instead of search_queries.",
      },
      search_queries: {
        type: "array",
        required: false,
        description: "Optional explicit query strings to run (e.g. [\"x vacancy rate 2026\"]). Provide objective and/or this.",
      },
      processor: {
        type: "string",
        required: false,
        default: "base",
        description: "base (fast, default) or pro (deeper, slower/costlier).",
      },
      max_results: {
        type: "number",
        required: false,
        default: 5,
        description: "Max results to return (default 5).",
      },
      max_chars_per_result: {
        type: "number",
        required: false,
        description: "Optional cap on extracted characters per result.",
      },
    },
    async execute(input: any, ctx: Ctx) {
      const cfg = (ctx.connection.config ?? {}) as Record<string, string>;
      const apiKey = cfg.apiKey;
      if (!apiKey) throw new Error("Missing PARALLEL_API_KEY. Configure it before using the parallel plugin.");
      const baseUrl = (cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");

      const objective = typeof input.objective === "string" ? input.objective.trim() : "";
      const queries = Array.isArray(input.search_queries)
        ? input.search_queries.map((q: unknown) => String(q)).filter((q: string) => q.trim())
        : [];
      if (!objective && !queries.length) {
        throw new Error("Provide objective and/or search_queries");
      }

      const body: Record<string, unknown> = {
        processor: String(input.processor || "base"),
        max_results: Number(input.max_results) > 0 ? Math.floor(Number(input.max_results)) : 5,
      };
      if (objective) body.objective = objective;
      if (queries.length) body.search_queries = queries;
      if (Number(input.max_chars_per_result) > 0) {
        body.max_chars_per_result = Math.floor(Number(input.max_chars_per_result));
      }

      const res = await fetch(`${baseUrl}/v1beta/search`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Parallel search -> ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = text ? JSON.parse(text) : {};
      const results = (data.results ?? []).map((r: any) => ({
        url: r.url,
        title: r.title,
        excerpts: r.excerpts ?? [],
      }));
      return {
        searchId: data.search_id,
        count: results.length,
        results,
        warnings: data.warnings ?? undefined,
        source: "parallel.search",
      };
    },
  });
}
