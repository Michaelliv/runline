import { staticCredential } from "../../_shared/credentials.js";

/** An API key, added by the transport as the api_key field of every UptimeRobot form. */
export const uptimerobotCredential = staticCredential({
  id: "uptimerobot",
  auth: {
    kind: "static",
    parts: ["key"],
    placements: [{ in: "body", part: "key", name: "api_key" }],
  },
  local: { key: "apiKey" },
  targets: {
    api: { baseUrl: "https://api.uptimerobot.com/v2/", methods: ["POST"] },
  },
});
