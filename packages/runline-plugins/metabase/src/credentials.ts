import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/** A session token, sent as X-Metabase-Session, to the instance's own /api/. */
export const metabaseCredential = staticCredential({
  id: "metabase",
  auth: { kind: "apiKey", header: "X-Metabase-Session" },
  local: { secret: "sessionToken" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, "api/"),
      methods: ["GET", "POST"],
    },
  }),
  probe: {
    target: "api",
    path: "user/current",
    method: "GET",
    acceptedStatuses: [200],
  },
});
