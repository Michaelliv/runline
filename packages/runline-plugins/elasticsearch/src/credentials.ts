import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An optional username and password, sent as HTTP Basic to the cluster;
 * without them, requests go unsigned. The cluster URL is public config
 * and must be HTTPS.
 */
export const elasticsearchCredential = staticCredential({
  id: "elasticsearch",
  auth: { kind: "basic" },
  local: { username: "username", password: "password" },
  optional: true,
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.baseUrl, ""),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
