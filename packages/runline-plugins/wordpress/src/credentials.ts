import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * A user's application password as the Basic pair, on the connection's own
 * site beneath /wp-json/wp/v2/.
 */
export const wordpressCredential = staticCredential({
  id: "wordpress",
  auth: { kind: "basic" },
  local: { username: "username", password: "password" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, "wp-json/wp/v2/"),
      methods: ["GET", "POST", "DELETE"],
    },
  }),
});
