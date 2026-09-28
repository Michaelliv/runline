import { staticCredential } from "../../_shared/credentials.js";

/**
 * The API secret, added by the transport as api_secret: a field of every
 * write's JSON body, and a query parameter on reads and deletes.
 */
export const convertkitCredential = staticCredential({
  id: "convertkit",
  auth: {
    kind: "static",
    parts: ["secret"],
    placements: [{ in: "body", part: "secret", name: "api_secret" }],
  },
  local: { secret: "apiSecret" },
  targets: {
    api: {
      baseUrl: "https://api.convertkit.com/v3/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "account",
    method: "GET",
    acceptedStatuses: [200],
  },
});
