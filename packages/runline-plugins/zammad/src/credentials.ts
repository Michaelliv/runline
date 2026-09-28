import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/** An access token, sent as `Authorization: Token token={token}` to the
 *  connection's own Zammad instance beneath /api/v1/. The instance URL is
 *  public config and must be HTTPS. */
export const zammadCredential = staticCredential({
  id: "zammad",
  auth: { kind: "apiKey", header: "Authorization", prefix: "Token token=" },
  local: { secret: "token" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, "api/v1/"),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
