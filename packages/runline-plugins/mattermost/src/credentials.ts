import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/** A personal access or bot token, sent as a bearer to the configured server. */
export const mattermostCredential = staticCredential({
  id: "mattermost",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.baseUrl, "api/v4/"),
      methods: ["GET", "POST", "DELETE"],
    },
  }),
  probe: {
    target: "api",
    path: "users/me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
