import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An API key, sent as the Api-Key header beneath /api/ of the configured
 * region base (US default, EU override). The base is public config and
 * must be HTTPS.
 */
export const iterableCredential = staticCredential({
  id: "iterable",
  auth: { kind: "apiKey", header: "Api-Key" },
  local: { secret: "apiKey" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.region ?? "https://api.iterable.com", "api/"),
      methods: ["GET", "POST", "DELETE"],
    },
  }),
});
