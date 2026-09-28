import { staticCredential } from "../../_shared/credentials.js";

/** An API key and secret, sent as the Api-Key and Api-Secret headers to Demio's one API origin. */
export const demioCredential = staticCredential({
  id: "demio",
  auth: {
    kind: "static",
    parts: ["key", "secret"],
    placements: [
      { in: "header", part: "key", name: "Api-Key" },
      { in: "header", part: "secret", name: "Api-Secret" },
    ],
  },
  local: { key: "apiKey", secret: "apiSecret" },
  targets: {
    api: {
      baseUrl: "https://my.demio.com/api/v1/",
      methods: ["GET", "PUT"],
    },
  },
  probe: {
    target: "api",
    path: "ping",
    method: "GET",
    acceptedStatuses: [200],
  },
});
