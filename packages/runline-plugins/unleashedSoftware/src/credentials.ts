import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API ID, sent as the api-auth-id header, and an API key that signs
 * the query of every request: the transport sends its HMAC-SHA256 as
 * api-auth-signature and never the key itself.
 */
export const unleashedSoftwareCredential = staticCredential({
  id: "unleashedSoftware",
  auth: {
    kind: "static",
    parts: ["apiId", "apiKey"],
    placements: [
      { in: "header", part: "apiId", name: "api-auth-id" },
      { in: "querySignature", part: "apiKey", name: "api-auth-signature" },
    ],
  },
  local: { apiId: "apiId", apiKey: "apiKey" },
  targets: {
    api: { baseUrl: "https://api.unleashedsoftware.com/", methods: ["GET"] },
  },
});
