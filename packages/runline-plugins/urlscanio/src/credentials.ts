import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent as the API-Key header to urlscan.io's v1 API. */
export const urlscanioCredential = staticCredential({
  id: "urlscanio",
  auth: { kind: "apiKey", header: "API-Key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://urlscan.io/api/v1/",
      methods: ["GET", "POST"],
    },
  },
});
