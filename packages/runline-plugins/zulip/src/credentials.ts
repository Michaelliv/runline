import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * The bot's email and API key as a Basic pair, beneath the connection's
 * own Zulip server. The server must be HTTPS.
 */
export const zulipCredential = staticCredential({
  id: "zulip",
  auth: { kind: "basic" },
  local: { username: "email", password: "apiKey" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, "api/v1/"),
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
  }),
});
