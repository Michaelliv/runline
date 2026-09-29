import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent in the X-Api-Key header to Clockify's one API origin. */
export const clockifyCredential = staticCredential({
  id: "clockify",
  auth: { kind: "apiKey", header: "X-Api-Key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.clockify.me/api/v1/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "user",
    method: "GET",
    acceptedStatuses: [200],
  },
});
