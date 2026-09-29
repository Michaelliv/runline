import { staticCredential } from "../../_shared/credentials.js";

/** A personal API token, sent as the auth_token query parameter. */
export const beeminderCredential = staticCredential({
  id: "beeminder",
  auth: { kind: "queryKey", param: "auth_token" },
  local: { secret: "apiToken" },
  targets: {
    api: {
      baseUrl: "https://www.beeminder.com/api/v1/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "users/me.json",
    method: "GET",
    acceptedStatuses: [200],
  },
});
