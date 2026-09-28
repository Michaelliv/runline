import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An API token, sent as the xc-token header to the connection's own NocoDB
 * instance beneath /api/v2/.
 */
export const nocodbCredential = staticCredential({
  id: "nocodb",
  auth: { kind: "apiKey", header: "xc-token" },
  local: { secret: "apiToken" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.host, "api/v2/"),
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
  }),
});
