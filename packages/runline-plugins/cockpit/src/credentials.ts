import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An API token, appended by the transport as the token query parameter on
 * the connection's own Cockpit instance beneath /api/. The instance URL is
 * public config and must be HTTPS.
 */
export const cockpitCredential = staticCredential({
  id: "cockpit",
  auth: { kind: "queryKey", param: "token" },
  local: { secret: "accessToken" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, "api/"),
      methods: ["GET", "POST"],
    },
  }),
});
