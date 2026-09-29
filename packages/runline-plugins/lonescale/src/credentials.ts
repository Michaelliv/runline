import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent as the X-API-KEY header to LoneScale's public API. */
export const lonescaleCredential = staticCredential({
  id: "lonescale",
  auth: { kind: "apiKey", header: "X-API-KEY" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://public-api.lonescale.com/",
      methods: ["GET", "POST"],
    },
  },
});
