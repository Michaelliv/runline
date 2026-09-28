import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent as the X-Phantombuster-Key header to the v2 API. */
export const phantombusterCredential = staticCredential({
  id: "phantombuster",
  auth: { kind: "apiKey", header: "X-Phantombuster-Key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.phantombuster.com/api/v2/",
      methods: ["GET", "POST"],
    },
  },
  probe: {
    target: "api",
    path: "agents/fetch-all",
    method: "GET",
    acceptedStatuses: [200],
  },
});
