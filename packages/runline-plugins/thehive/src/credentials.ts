import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/** An API key, sent as a bearer to the connection's own TheHive instance
 *  beneath /api/. The instance URL is public config and must be HTTPS. */
export const thehiveCredential = staticCredential({
  id: "thehive",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, "api/"),
      methods: ["GET", "POST", "PATCH"],
    },
  }),
});
