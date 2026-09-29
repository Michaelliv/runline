import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An account API key, sent as the Api-Token header to the connection's own
 * ActiveCampaign API origin beneath /api/3/.
 */
export const activeCampaignCredential = staticCredential({
  id: "activeCampaign",
  auth: { kind: "apiKey", header: "Api-Token" },
  local: { secret: "apiKey" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.apiUrl, "api/3/"),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
  probe: {
    target: "api",
    path: "users/me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
