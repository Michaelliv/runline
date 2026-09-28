import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API key, sent as a bearer to Airtop's two path prefixes on one
 * origin: the v1 API, and the hooks base that agent webhooks invoke.
 */
export const airtopCredential = staticCredential({
  id: "airtop",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.airtop.ai/api/v1/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
    hooks: {
      baseUrl: "https://api.airtop.ai/api/hooks/",
      methods: ["POST"],
    },
  },
});
