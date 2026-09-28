import { hostLabel, staticCredential } from "../../_shared/credentials.js";

/**
 * The account email and REST API key, sent as HTTP Basic to the
 * connection's own Agile CRM subdomain.
 */
export const agileCrmCredential = staticCredential({
  id: "agileCrm",
  auth: { kind: "basic" },
  local: { username: "email", password: "apiKey" },
  targets: (config) => ({
    api: {
      baseUrl: `https://${hostLabel(config.subdomain)}.agilecrm.com/dev/`,
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
