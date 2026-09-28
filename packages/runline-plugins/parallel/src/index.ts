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
import type { RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { DEFAULT_BASE, parallelCredential } from "./credentials.js";

const NAME = "parallel";

interface SearchResult {
  url?: string;
  title?: string;
  excerpts?: string[];
}

interface SearchAnswer {
  search_id?: string;
  results?: SearchResult[];
  warnings?: unknown;
}

export default function parallel(rl: RunlinePluginAPI): void {
  rl.setName(NAME);
  rl.setVersion("0.1.0");
  rl.setCredential(parallelCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      env: "PARALLEL_API_KEY",
      description:
        "Parallel.ai API key (sent as the x-api-key header). Store only in secrets.",
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
    access: "read",
    description:
      "Search the live web with Parallel.ai and get ranked results with extracted excerpts. Use this to ground answers in current web content (news, prices, regulations, company info) instead of stale knowledge. Provide an `objective` (natural-language goal) and/or explicit `search_queries`.",
    inputSchema: {
      objective: {
        type: "string",
        required: false,
        description:
          "Natural-language description of what you're trying to find. Recommended; can be used with or instead of search_queries.",
      },
      search_queries: {
        type: "array",
        required: false,
        description:
          'Optional explicit query strings to run (e.g. ["x vacancy rate 2026"]). Provide objective and/or this.',
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
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const objective =
        typeof p.objective === "string" ? p.objective.trim() : "";
      const queries = Array.isArray(p.search_queries)
        ? p.search_queries.map((q) => String(q)).filter((q) => q.trim())
        : [];
      if (!objective && !queries.length) {
        throw new Error("Provide objective and/or search_queries");
      }

      const body: Record<string, unknown> = {
        processor: String(p.processor || "base"),
        max_results:
          Number(p.max_results) > 0 ? Math.floor(Number(p.max_results)) : 5,
      };
      if (objective) body.objective = objective;
      if (queries.length) body.search_queries = queries;
      if (Number(p.max_chars_per_result) > 0) {
        body.max_chars_per_result = Math.floor(Number(p.max_chars_per_result));
      }

      const data = await credentialJson<SearchAnswer>(
        ctx,
        parallelCredential,
        NAME,
        {
          target: "api",
          path: "search",
          method: "POST",
          json: body,
        },
      );
      const results = (data.results ?? []).map((r) => ({
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
