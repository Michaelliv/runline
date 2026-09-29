import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * A Mautic user's Basic credentials, on the connection's own instance
 * beneath /api/.
 */
export const mauticCredential = staticCredential({
  id: "mautic",
  auth: { kind: "basic" },
  local: { username: "username", password: "password" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, "api/"),
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
  }),
});
