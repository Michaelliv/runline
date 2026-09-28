import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * A login token, sent as a bearer to the /api surface of the
 * connection's own Wekan server.
 */
export const wekanCredential = staticCredential({
  id: "wekan",
  auth: { kind: "bearer" },
  local: { secret: "token" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, "api/"),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
