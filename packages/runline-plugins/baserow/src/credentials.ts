import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * A database token, sent as `Authorization: Token {token}` to the
 * configured host's /api/ base. The host is public config and must be
 * HTTPS.
 */
export const baserowCredential = staticCredential({
  id: "baserow",
  auth: { kind: "apiKey", header: "Authorization", prefix: "Token " },
  local: { secret: "token" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.host, "api/"),
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
  }),
});
