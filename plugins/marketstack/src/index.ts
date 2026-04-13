import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  apiKey: string, useHttps: boolean, method: string, endpoint: string,
  qs: Record<string, unknown> = {},
): Promise<unknown> {
  const protocol = useHttps ? "https" : "http";
  const url = new URL(`${protocol}://api.marketstack.com/v1${endpoint}`);
  url.searchParams.set("access_key", apiKey);
  for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); }
  const res = await fetch(url.toString(), { method });
  if (!res.ok) throw new Error(`Marketstack API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function paginateAll(
  apiKey: string, useHttps: boolean, endpoint: string,
  qs: Record<string, unknown> = {}, limit?: number,
): Promise<unknown[]> {
  const all: unknown[] = [];
  qs.offset = 0;
  let resp: Record<string, unknown>;
  do {
    resp = (await apiRequest(apiKey, useHttps, "GET", endpoint, qs)) as Record<string, unknown>;
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

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Marketstack API access key", env: "MARKETSTACK_API_KEY" },
    useHttps: { type: "boolean", required: false, description: "Use HTTPS (requires paid plan). Default: false", default: false },
  });

  const conn = (ctx: { connection: { config: Record<string, unknown> } }) => ({
    apiKey: ctx.connection.config.apiKey as string,
    useHttps: (ctx.connection.config.useHttps as boolean) ?? false,
  });

  // ── End-of-Day Data ─────────────────────────────────

  rl.registerAction("endOfDayData.list", {
    description: "Get end-of-day stock market closing data. Must specify exactly one of: latest, specificDate, or dateFrom+dateTo.",
    inputSchema: {
      symbols: { type: "string", required: true, description: "Comma-separated stock symbols (e.g. AAPL,MSFT)" },
      latest: { type: "boolean", required: false, description: "Get latest EOD data" },
      specificDate: { type: "string", required: false, description: "Specific date (YYYY-MM-DD)" },
      dateFrom: { type: "string", required: false, description: "Start date (YYYY-MM-DD)" },
      dateTo: { type: "string", required: false, description: "End date (YYYY-MM-DD)" },
      sort: { type: "string", required: false, description: "ASC or DESC" },
      exchange: { type: "string", required: false, description: "Filter by exchange MIC" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const { apiKey, useHttps } = conn(ctx);
      const qs: Record<string, unknown> = { symbols: p.symbols };
      if (p.sort) qs.sort = p.sort;
      if (p.exchange) qs.exchange = p.exchange;

      let endpoint: string;
      if (p.latest) {
        endpoint = "/eod/latest";
      } else if (p.specificDate) {
        endpoint = `/eod/${(p.specificDate as string).split("T")[0]}`;
      } else if (p.dateFrom && p.dateTo) {
        endpoint = "/eod";
        qs.date_from = (p.dateFrom as string).split("T")[0];
        qs.date_to = (p.dateTo as string).split("T")[0];
      } else {
        throw new Error("Specify one of: latest (true), specificDate, or dateFrom+dateTo");
      }

      return paginateAll(apiKey, useHttps, endpoint, qs, p.limit as number | undefined);
    },
  });

  // ── Exchange ────────────────────────────────────────

  rl.registerAction("exchange.get", {
    description: "Get details about a stock exchange",
    inputSchema: { exchange: { type: "string", required: true, description: "Exchange MIC code (e.g. XNAS)" } },
    async execute(input, ctx) {
      const { apiKey, useHttps } = conn(ctx);
      return apiRequest(apiKey, useHttps, "GET", `/exchanges/${(input as { exchange: string }).exchange}`);
    },
  });

  // ── Ticker ──────────────────────────────────────────

  rl.registerAction("ticker.get", {
    description: "Get details about a stock ticker symbol",
    inputSchema: { symbol: { type: "string", required: true, description: "Ticker symbol (e.g. AAPL)" } },
    async execute(input, ctx) {
      const { apiKey, useHttps } = conn(ctx);
      return apiRequest(apiKey, useHttps, "GET", `/tickers/${(input as { symbol: string }).symbol}`);
    },
  });
}
