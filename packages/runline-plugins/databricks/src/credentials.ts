import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/** A personal access token, sent as a bearer to the workspace host in config. */
export const databricksCredential = staticCredential({
  id: "databricks",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: (config) => ({
    workspace: {
      baseUrl: httpsBase(config.host, ""),
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    },
  }),
});
