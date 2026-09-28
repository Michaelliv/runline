import { staticCredential } from "../../_shared/credentials.js";

/** A personal or OAuth2 token, sent raw in Authorization, to ClickUp's one API origin. */
export const clickupCredential = staticCredential({
  id: "clickup",
  auth: { kind: "apiKey", header: "Authorization" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.clickup.com/api/v2/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "user",
    method: "GET",
    acceptedStatuses: [200],
  },
});
