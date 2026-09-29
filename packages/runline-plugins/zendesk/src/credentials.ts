import { hostLabel, staticCredential } from "../../_shared/credentials.js";

/**
 * An API token as the Basic password, with the agent email joined to the
 * fixed /token suffix as the username, on the account's own Zendesk
 * subdomain.
 */
export const zendeskCredential = staticCredential({
  id: "zendesk",
  auth: { kind: "basic" },
  local: {
    username: { concat: [{ field: "email" }, { value: "/token" }] },
    password: "apiToken",
  },
  targets: (config) => ({
    api: {
      baseUrl: `https://${hostLabel(config.subdomain)}.zendesk.com/api/v2/`,
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
  probe: {
    target: "api",
    path: "users/me.json",
    method: "GET",
    acceptedStatuses: [200],
  },
});
