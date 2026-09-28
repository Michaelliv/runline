import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * The bot token, which Telegram takes as the path segment bot<token> on the
 * Bot API: api.telegram.org, or the connection's own HTTPS Bot API server.
 */
export const telegramCredential = staticCredential({
  id: "telegram",
  auth: {
    kind: "static",
    parts: ["token"],
    placements: [{ in: "path", part: "token", prefix: "bot" }],
  },
  local: { token: "accessToken" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.baseUrl || "https://api.telegram.org", ""),
      methods: ["POST"],
    },
  }),
});
