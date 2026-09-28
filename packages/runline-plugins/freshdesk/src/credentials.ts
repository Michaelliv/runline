import { hostLabel, staticCredential } from "../../_shared/credentials.js";

/** An agent API key as the Basic username, with the fixed dummy password "X",
 *  to the account's own Freshdesk subdomain. */
export const freshdeskCredential = staticCredential({
  id: "freshdesk",
  auth: { kind: "basic" },
  local: { username: "apiKey", password: { value: "X" } },
  targets: (config) => ({
    api: {
      baseUrl: `https://${hostLabel(config.domain)}.freshdesk.com/api/v2/`,
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
  probe: {
    target: "api",
    path: "agents/me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
