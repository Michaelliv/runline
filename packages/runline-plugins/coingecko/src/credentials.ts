import { staticCredential } from "../../_shared/credentials.js";

/**
 * An optional demo API key, sent in the x-cg-demo-api-key header to
 * CoinGecko's public API; without one, requests go unsigned.
 */
export const coingeckoCredential = staticCredential({
  id: "coingecko",
  auth: { kind: "apiKey", header: "x-cg-demo-api-key" },
  local: { secret: "apiKey" },
  optional: true,
  targets: {
    api: { baseUrl: "https://api.coingecko.com/api/v3/", methods: ["GET"] },
  },
  probe: {
    target: "api",
    path: "ping",
    method: "GET",
    acceptedStatuses: [200],
  },
});
