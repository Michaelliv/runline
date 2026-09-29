import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An API token, appended by the transport as the authtoken query parameter
 * on the connection's own Rundeck server beneath /api/.
 */
export const rundeckCredential = staticCredential({
  id: "rundeck",
  auth: { kind: "queryKey", param: "authtoken" },
  local: { secret: "token" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, "api/"),
      methods: ["GET", "POST"],
    },
  }),
});
