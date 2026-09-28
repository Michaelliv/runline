import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An SSWS API token, sent as `Authorization: SSWS {token}` to the
 * configured org's /api/v1/ base. The org URL is public config and must
 * be HTTPS.
 */
export const oktaCredential = staticCredential({
  id: "okta",
  auth: { kind: "apiKey", header: "Authorization", prefix: "SSWS " },
  local: { secret: "apiToken" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, "api/v1/"),
      methods: ["GET", "POST", "DELETE"],
    },
  }),
  probe: {
    target: "api",
    path: "users/me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
