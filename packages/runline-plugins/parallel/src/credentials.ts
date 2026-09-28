import { httpsBase, staticCredential } from "../../_shared/credentials.js";

export const DEFAULT_BASE = "https://api.parallel.ai";

/**
 * An API key, sent as the x-api-key header to the configured Parallel.ai
 * API base (api.parallel.ai unless overridden). The base URL is public
 * config and must be HTTPS.
 */
export const parallelCredential = staticCredential({
  id: "parallel",
  auth: { kind: "apiKey", header: "x-api-key" },
  local: { secret: "apiKey" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.baseUrl ?? DEFAULT_BASE, "v1beta/"),
      methods: ["POST"],
    },
  }),
});
