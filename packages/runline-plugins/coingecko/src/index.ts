import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.coingecko.com/api/v3";

async function apiRequest(
  endpoint: string,
  qs?: Record<string, unknown>,
  apiKey?: string,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-cg-demo-api-key"] = apiKey;
  const res = await fetch(url.toString(), { headers });
  if (!res.ok)
    throw new Error(`CoinGecko API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function coingecko(rl: RunlinePluginAPI) {
  rl.setName("coingecko");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: false,
      description: "CoinGecko API key (optional for free tier)",
      env: "COINGECKO_API_KEY",
    },
  });

  function getKey(ctx: {
    connection: { config: Record<string, unknown> };
  }): string | undefined {
    return ctx.connection.config.apiKey as string | undefined;
  }

  // ── Coin ────────────────────────────────────────────

  rl.registerAction("coin.get", {
    access: "read",
    description: "Get detailed coin data by ID or contract address",
    inputSchema: {
      coinId: {
        type: "string",
        required: false,
        description: "Coin ID (e.g. bitcoin)",
      },
      platformId: {
        type: "string",
        required: false,
        description: "Platform ID for contract lookup",
      },
      contractAddress: {
        type: "string",
        required: false,
        description: "Contract address",
      },
      communityData: {
        type: "boolean",
        required: false,
        description: "Include community data",
      },
      developerData: {
        type: "boolean",
        required: false,
        description: "Include developer data",
      },
      marketData: {
        type: "boolean",
        required: false,
        description: "Include market data",
      },
      tickers: {
        type: "boolean",
        required: false,
        description: "Include tickers",
      },
    },
    async execute(input, ctx) {
      const {
        coinId,
        platformId,
        contractAddress,
        communityData,
        developerData,
        marketData,
        tickers,
      } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        community_data: communityData ?? false,
        developer_data: developerData ?? false,
        localization: false,
        market_data: marketData ?? false,
        sparkline: false,
        tickers: tickers ?? false,
      };
      if (contractAddress && platformId) {
        return apiRequest(
          `/coins/${platformId}/contract/${contractAddress}`,
          qs,
          getKey(ctx),
        );
      }
      return apiRequest(`/coins/${coinId}`, qs, getKey(ctx));
    },
  });

  rl.registerAction("coin.list", {
    access: "read",
    description: "List all supported coins",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await apiRequest(
        "/coins/list",
        undefined,
        getKey(ctx),
      )) as unknown[];
      if (limit) return data.slice(0, limit);
      return data;
    },
  });

  rl.registerAction("coin.market", {
    access: "read",
    description:
      "Get coin market data (price, mcap, volume) for multiple coins",
    inputSchema: {
      vsCurrency: {
        type: "string",
        required: true,
        description: "Quote currency (e.g. usd)",
      },
      ids: {
        type: "string",
        required: false,
        description: "Comma-separated coin IDs",
      },
      category: {
        type: "string",
        required: false,
        description: "Category filter",
      },
      order: { type: "string", required: false, description: "Sort order" },
      priceChangePercentage: {
        type: "string",
        required: false,
        description: "Comma-separated periods (1h,24h,7d,14d,30d,200d,1y)",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results (default: 100)",
      },
    },
    async execute(input, ctx) {
      const { vsCurrency, ids, category, order, priceChangePercentage, limit } =
        (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { vs_currency: vsCurrency };
      if (ids) qs.ids = ids;
      if (category) qs.category = category;
      if (order) qs.order = order;
      if (priceChangePercentage)
        qs.price_change_percentage = priceChangePercentage;
      if (limit) qs.per_page = limit;
      return apiRequest("/coins/markets", qs, getKey(ctx));
    },
  });

  rl.registerAction("coin.price", {
    access: "read",
    description: "Get simple price for coins",
    inputSchema: {
      ids: {
        type: "string",
        required: true,
        description: "Comma-separated coin IDs",
      },
      vsCurrencies: {
        type: "string",
        required: true,
        description: "Comma-separated quote currencies",
      },
      includeMarketCap: {
        type: "boolean",
        required: false,
        description: "Include market cap",
      },
      include24hrVol: {
        type: "boolean",
        required: false,
        description: "Include 24h volume",
      },
      include24hrChange: {
        type: "boolean",
        required: false,
        description: "Include 24h change",
      },
    },
    async execute(input, ctx) {
      const {
        ids,
        vsCurrencies,
        includeMarketCap,
        include24hrVol,
        include24hrChange,
      } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        ids,
        vs_currencies: vsCurrencies,
      };
      if (includeMarketCap) qs.include_market_cap = true;
      if (include24hrVol) qs.include_24hr_vol = true;
      if (include24hrChange) qs.include_24hr_change = true;
      return apiRequest("/simple/price", qs, getKey(ctx));
    },
  });

  rl.registerAction("coin.tokenPrice", {
    access: "read",
    description: "Get token price by contract address",
    inputSchema: {
      platformId: {
        type: "string",
        required: true,
        description: "Platform ID (e.g. ethereum)",
      },
      contractAddresses: {
        type: "string",
        required: true,
        description: "Comma-separated contract addresses",
      },
      vsCurrencies: {
        type: "string",
        required: true,
        description: "Comma-separated quote currencies",
      },
    },
    async execute(input, ctx) {
      const { platformId, contractAddresses, vsCurrencies } = input as Record<
        string,
        string
      >;
      return apiRequest(
        `/simple/token_price/${platformId}`,
        {
          contract_addresses: contractAddresses,
          vs_currencies: vsCurrencies,
        },
        getKey(ctx),
      );
    },
  });

  rl.registerAction("coin.ticker", {
    access: "read",
    description: "Get tickers for a coin",
    inputSchema: {
      coinId: { type: "string", required: true, description: "Coin ID" },
      exchangeIds: {
        type: "string",
        required: false,
        description: "Comma-separated exchange IDs",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { coinId, exchangeIds, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (exchangeIds) qs.exchange_ids = exchangeIds;
      const data = (await apiRequest(
        `/coins/${coinId}/tickers`,
        qs,
        getKey(ctx),
      )) as Record<string, unknown>;
      const tickers = (data.tickers as unknown[]) ?? [];
      if (limit) return tickers.slice(0, limit as number);
      return tickers;
    },
  });

  rl.registerAction("coin.history", {
    access: "read",
    description: "Get historical data for a coin on a specific date",
    inputSchema: {
      coinId: { type: "string", required: true, description: "Coin ID" },
      date: {
        type: "string",
        required: true,
        description: "Date (DD-MM-YYYY format)",
      },
      localization: {
        type: "boolean",
        required: false,
        description: "Include localized languages",
      },
    },
    async execute(input, ctx) {
      const { coinId, date, localization } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { date };
      if (localization !== undefined) qs.localization = localization;
      return apiRequest(`/coins/${coinId}/history`, qs, getKey(ctx));
    },
  });

  rl.registerAction("coin.marketChart", {
    access: "read",
    description: "Get price, market cap, and volume chart data",
    inputSchema: {
      coinId: { type: "string", required: false, description: "Coin ID" },
      platformId: {
        type: "string",
        required: false,
        description: "Platform ID (for contract)",
      },
      contractAddress: {
        type: "string",
        required: false,
        description: "Contract address",
      },
      vsCurrency: {
        type: "string",
        required: true,
        description: "Quote currency",
      },
      days: {
        type: "string",
        required: true,
        description: "Number of days (1, 7, 14, 30, 90, 180, 365, max)",
      },
    },
    async execute(input, ctx) {
      const { coinId, platformId, contractAddress, vsCurrency, days } =
        input as Record<string, unknown>;
      const qs: Record<string, unknown> = { vs_currency: vsCurrency, days };
      let endpoint: string;
      if (contractAddress && platformId) {
        endpoint = `/coins/${platformId}/contract/${contractAddress}/market_chart`;
      } else {
        endpoint = `/coins/${coinId}/market_chart`;
      }
      const data = (await apiRequest(endpoint, qs, getKey(ctx))) as Record<
        string,
        unknown
      >;
      const prices = (data.prices as number[][]) ?? [];
      return prices.map((p, idx) => ({
        time: new Date(p[0]).toISOString(),
        price: p[1],
        marketCap: ((data.market_caps as number[][])?.[idx] ?? [])[1],
        totalVolume: ((data.total_volumes as number[][])?.[idx] ?? [])[1],
      }));
    },
  });

  rl.registerAction("coin.candlestick", {
    access: "read",
    description: "Get OHLC candlestick data",
    inputSchema: {
      coinId: { type: "string", required: true, description: "Coin ID" },
      vsCurrency: {
        type: "string",
        required: true,
        description: "Quote currency",
      },
      days: {
        type: "string",
        required: true,
        description: "Number of days (1, 7, 14, 30, 90, 180, 365, max)",
      },
    },
    async execute(input, ctx) {
      const { coinId, vsCurrency, days } = input as Record<string, string>;
      const data = (await apiRequest(
        `/coins/${coinId}/ohlc`,
        {
          vs_currency: vsCurrency,
          days,
        },
        getKey(ctx),
      )) as number[][];
      return data.map(([time, open, high, low, close]) => ({
        time: new Date(time).toISOString(),
        open,
        high,
        low,
        close,
      }));
    },
  });

  // ── Event ───────────────────────────────────────────

  rl.registerAction("event.list", {
    access: "read",
    description: "List crypto events",
    inputSchema: {
      countryCode: {
        type: "string",
        required: false,
        description: "Country code filter",
      },
      type: {
        type: "string",
        required: false,
        description: "Event type filter",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { countryCode, type, limit } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (countryCode) qs.country_code = countryCode;
      if (type) qs.type = type;
      if (limit) qs.per_page = limit;
      const data = (await apiRequest("/events", qs, getKey(ctx))) as Record<
        string,
        unknown
      >;
      return data.data;
    },
  });
}
