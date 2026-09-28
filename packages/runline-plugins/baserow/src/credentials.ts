import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * A database token, sent as `Authorization: Token {token}` to the
 * configured host's /api/ base — Baserow's cloud unless the connection
 * names a self-hosted one, which must be HTTPS.
 */
export const baserowCredential = staticCredential({
  id: "baserow",
  auth: { kind: "apiKey", header: "Authorization", prefix: "Token " },
  local: { secret: "token" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.host ?? "https://api.baserow.io", "api/"),
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
  }),
});
