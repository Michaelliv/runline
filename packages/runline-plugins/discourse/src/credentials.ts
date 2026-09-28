import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An admin API key, sent as the Api-Key header to the connection's own
 * Discourse instance. The public Api-Username companion header names the
 * user the key acts as.
 */
export const discourseCredential = staticCredential({
  id: "discourse",
  auth: { kind: "apiKey", header: "Api-Key" },
  local: { secret: "apiKey" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.host, ""),
      methods: ["GET", "POST", "PUT", "DELETE"],
      allowedHeaders: ["Api-Username"],
    },
  }),
});
