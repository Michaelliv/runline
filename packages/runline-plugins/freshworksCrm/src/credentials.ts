import { hostLabel, staticCredential } from "../../_shared/credentials.js";

/**
 * The API key in Freshworks' `Token token=` Authorization scheme, sent to
 * the connection's own bundle domain.
 */
export const freshworksCrmCredential = staticCredential({
  id: "freshworksCrm",
  auth: { kind: "apiKey", header: "Authorization", prefix: "Token token=" },
  local: { secret: "apiKey" },
  targets: (config) => ({
    api: {
      baseUrl: `https://${hostLabel(config.domain)}.myfreshworks.com/crm/sales/api/`,
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
