import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * A MISP automation key, sent raw in the Authorization header to the
 * connection's own instance.
 */
export const mispCredential = staticCredential({
  id: "misp",
  auth: { kind: "apiKey", header: "Authorization" },
  local: { secret: "apiKey" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.baseUrl, ""),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
