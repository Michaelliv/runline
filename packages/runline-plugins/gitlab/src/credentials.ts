import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * A personal access token, sent as the PRIVATE-TOKEN header to the
 * server's /api/v4/ base: gitlab.com, or the connection's own HTTPS
 * server. Project, file and tag paths travel as one encoded segment.
 */
export const gitlabCredential = staticCredential({
  id: "gitlab",
  auth: { kind: "apiKey", header: "PRIVATE-TOKEN" },
  local: { secret: "token" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.server ?? "https://gitlab.com", "api/v4/"),
      methods: ["GET", "POST", "PUT", "DELETE"],
      encodedSlashes: true,
    },
  }),
  probe: {
    target: "api",
    path: "user",
    method: "GET",
    acceptedStatuses: [200],
  },
});
