import { staticCredential } from "../../_shared/credentials.js";

/** A bot token, sent as `Authorization: Bot {token}` to Discord's v10 API. */
export const discordCredential = staticCredential({
  id: "discord",
  auth: { kind: "apiKey", header: "Authorization", prefix: "Bot " },
  local: { secret: "botToken" },
  targets: {
    api: {
      baseUrl: "https://discord.com/api/v10/",
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "users/@me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
