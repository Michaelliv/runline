import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * A project API key, added by the transport as the api_key field of every
 * JSON capture call, on the connection's own PostHog instance. The
 * instance URL is public config and must be HTTPS.
 */
export const posthogCredential = staticCredential({
  id: "posthog",
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
