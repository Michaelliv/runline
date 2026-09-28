import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An Atlassian API token with the account email as the Basic pair, on the
 * connection's own Jira site beneath /rest/.
 */
export const jiraCredential = staticCredential({
  id: "jira",
  auth: { kind: "basic" },
  local: { username: "email", password: "apiToken" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.domain, "rest/"),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
