import { staticCredential } from "../../_shared/credentials.js";

/**
 * A Steel API key: the steel-api-key header on the REST API, and the
 * apiKey query parameter of a session's CDP socket, which the broker
 * signs — or relays, under a host that keeps the key.
 */
export const steelCredential = staticCredential({
  id: "steel",
  auth: {
    kind: "static",
    parts: ["apiKey"],
    placements: [
      { in: "header", part: "apiKey", name: "steel-api-key", targets: ["api"] },
      { in: "query", part: "apiKey", name: "apiKey", targets: ["cdp"] },
    ],
  },
  local: { apiKey: "apiKey" },
  targets: {
    // Scrapes, screenshots and PDFs answer once the page has rendered.
    api: {
      baseUrl: "https://api.steel.dev/",
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      timeoutMs: 120_000,
    },
    cdp: { baseUrl: "wss://connect.steel.dev/", methods: ["GET"], socket: true },
  },
});
