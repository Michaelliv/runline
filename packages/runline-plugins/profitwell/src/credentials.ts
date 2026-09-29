import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API access token, sent raw in the Authorization header (no scheme)
 * to ProfitWell's one API origin beneath /v2/.
 */
export const profitwellCredential = staticCredential({
  id: "profitwell",
  auth: { kind: "apiKey", header: "Authorization" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.profitwell.com/v2/",
      methods: ["GET"],
    },
  },
  probe: {
    target: "api",
    path: "company/settings/",
    method: "GET",
    acceptedStatuses: [200],
  },
});
