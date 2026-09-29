import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { marketstackCredential } from "./credentials.js";

function api(
  ctx: ActionContext,
  endpoint: string,
  qs: Record<string, unknown> = {},
): Promise<unknown> {
  return credentialJson(ctx, marketstackCredential, "marketstack", {
    target: "api",
    path: endpoint,
    query: qs,
  });
}

async function paginateAll(
  ctx: ActionContext,
  endpoint: string,
  qs: Record<string, unknown> = {},
  limit?: number,
): Promise<unknown[]> {
  const all: unknown[] = [];
  qs.offset = 0;
  let resp: Record<string, unknown>;
  do {
    resp = (await api(ctx, endpoint, qs)) as Record<string, unknown>;
    const data = resp.data as unknown[];
    if (data) all.push(...data);
    if (limit && all.length >= limit) return all.slice(0, limit);
    (qs.offset as number) += (resp.count as number) ?? 0;
  } while ((resp.total as number) > all.length);
  return all;
}

export default function marketstack(rl: RunlinePluginAPI) {
  rl.setName("marketstack");
  rl.setVersion("0.1.0");
  rl.setCredential(marketstackCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Marketstack API access key",
      env: "MARKETSTACK_API_KEY",
    },
    useHttps: {
      type: "boolean",
      required: false,
      description: "Ignored: requests always use HTTPS",
      default: false,
    },
  });

  // ── End-of-Day Data ─────────────────────────────────

  rl.registerAction("endOfDayData.list", {
    access: "read",
    description:
      "Get end-of-day stock market closing data. Must specify exactly one of: latest, specificDate, or dateFrom+dateTo.",
    inputSchema: {
      symbols: {
        type: "string",
        required: true,
        description: "Comma-separated stock symbols (e.g. AAPL,MSFT)",
      },
      latest: {
        type: "boolean",
        required: false,
        description: "Get latest EOD data",
      },
      specificDate: {
        type: "string",
        required: false,
        description: "Specific date (YYYY-MM-DD)",
      },
      dateFrom: {
        type: "string",
        required: false,
        description: "Start date (YYYY-MM-DD)",
      },
      dateTo: {
        type: "string",
        required: false,
        description: "End date (YYYY-MM-DD)",
      },
      sort: { type: "string", required: false, description: "ASC or DESC" },
      exchange: {
        type: "string",
        required: false,
        description: "Filter by exchange MIC",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { symbols: p.symbols };
      if (p.sort) qs.sort = p.sort;
      if (p.exchange) qs.exchange = p.exchange;

      let endpoint: string;
      if (p.latest) {
        endpoint = "eod/latest";
      } else if (p.specificDate) {
        endpoint = `eod/${pathSegment((p.specificDate as string).split("T")[0])}`;
      } else if (p.dateFrom && p.dateTo) {
        endpoint = "eod";
        qs.date_from = (p.dateFrom as string).split("T")[0];
        qs.date_to = (p.dateTo as string).split("T")[0];
      } else {
        throw new Error(
          "Specify one of: latest (true), specificDate, or dateFrom+dateTo",
        );
      }

      return paginateAll(ctx, endpoint, qs, p.limit as number | undefined);
    },
  });

  // ── Exchange ────────────────────────────────────────

  rl.registerAction("exchange.get", {
    access: "read",
    description: "Get details about a stock exchange",
    inputSchema: {
      exchange: {
        type: "string",
        required: true,
        description: "Exchange MIC code (e.g. XNAS)",
      },
    },
    async execute(input, ctx) {
      return api(
        ctx,
        `exchanges/${pathSegment((input as { exchange: string }).exchange)}`,
      );
    },
  });

  // ── Ticker ──────────────────────────────────────────

  rl.registerAction("ticker.get", {
    access: "read",
    description: "Get details about a stock ticker symbol",
    inputSchema: {
      symbol: {
        type: "string",
        required: true,
        description: "Ticker symbol (e.g. AAPL)",
      },
    },
    async execute(input, ctx) {
      return api(
        ctx,
        `tickers/${pathSegment((input as { symbol: string }).symbol)}`,
      );
    },
  });
}
