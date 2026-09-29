import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API key, sent as `X-Auth-Token: api-key {key}` to GetResponse's v3
 * API base.
 */
export const getresponseCredential = staticCredential({
  id: "getresponse",
  auth: { kind: "apiKey", header: "X-Auth-Token", prefix: "api-key " },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.getresponse.com/v3/",
      methods: ["GET", "POST", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "accounts",
    method: "GET",
    acceptedStatuses: [200],
  },
});
