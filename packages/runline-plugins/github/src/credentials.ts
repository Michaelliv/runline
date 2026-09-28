import { httpsBase, staticCredential } from "../../_shared/credentials.js";

export const GITHUB_API_VERSION = "2022-11-28";

/**
 * A personal access token, sent as a bearer to the configured API origin —
 * github.com by default, a GitHub Enterprise host when baseUrl says so.
 */
export const githubCredential = staticCredential({
  id: "github",
  auth: { kind: "bearer" },
  local: { secret: "token" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.baseUrl ?? "https://api.github.com", ""),
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["X-GitHub-Api-Version"],
    },
  }),
});
