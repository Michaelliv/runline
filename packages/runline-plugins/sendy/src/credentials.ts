import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An API key, added by the transport as the api_key field of every form
 * call to the connection's own Sendy installation. The installation URL
 * is public config and must be HTTPS.
 */
export const sendyCredential = staticCredential({
  id: "sendy",
  auth: {
    kind: "static",
    parts: ["key"],
    placements: [{ in: "body", part: "key", name: "api_key" }],
  },
  local: { key: "apiKey" },
  targets: (config) => ({
    api: { baseUrl: httpsBase(config.url, ""), methods: ["POST"] },
  }),
});
