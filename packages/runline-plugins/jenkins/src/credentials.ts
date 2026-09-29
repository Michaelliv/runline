import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * The username and per-user API token, sent as HTTP Basic to the
 * connection's own Jenkins instance.
 */
export const jenkinsCredential = staticCredential({
  id: "jenkins",
  auth: { kind: "basic" },
  local: { username: "username", password: "apiToken" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.baseUrl, ""),
      methods: ["GET", "POST"],
    },
  }),
});
