import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * A service-account token or API key, sent as a bearer to the connection's
 * own Grafana instance beneath /api/.
 */
export const grafanaCredential = staticCredential({
  id: "grafana",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.baseUrl, "api/"),
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    },
  }),
});
