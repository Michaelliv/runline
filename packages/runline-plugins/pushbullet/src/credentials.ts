import { staticCredential } from "../../_shared/credentials.js";

/** An access token in the Access-Token header, to Pushbullet's one API origin. */
export const pushbulletCredential = staticCredential({
  id: "pushbullet",
  auth: { kind: "apiKey", header: "Access-Token" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.pushbullet.com/v2/",
      methods: ["GET", "POST", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "users/me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
