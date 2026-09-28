import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An integration access token, sent as a bearer to the connection's own
 * Magento store beneath /rest/.
 */
export const magentoCredential = staticCredential({
  id: "magento",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.host, "rest/"),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
